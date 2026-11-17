"""
generar_vuelo.py  --  BTS On-Time Performance -> data/vuelo.csv

Uso (desde la raiz del proyecto):
    python generar_vuelo.py            # usa ./raw_data y ./data
    python generar_vuelo.py <carpeta>  # raiz del proyecto en otra ruta

Entrada
    raw_data/bts*.csv              uno o varios meses del BTS (se concatenan)
    raw_data/airports_mod.dat      OpenFlights (Kaggle): aporta la zona horaria (tz Olson) por IATA
    data/aeropuerto.csv, ruta.csv, aeronave.csv, aerolinea.csv,
    data/terminal.csv, puerta_embarque.csv, pista.csv

Salida
    data/vuelo.csv   con EXACTAMENTE las columnas del CREATE TABLE vuelo
    data/ruta.csv    ampliada con los pares origen-destino del BTS que faltaban (AMPLIAR_RUTA)
    raw_data/vuelo_extra_bts.csv   id_vuelo + causas de retraso, codigo de cancelacion y distancia (opcional,
                                   NO se carga en MySQL; es material para las features de la Torre de Control)

Columnas BTS necesarias (marcalas en la descarga):
    FlightDate, Reporting_Airline, Flight_Number_Reporting_Airline, Tail_Number,
    Origin, Dest, CRSDepTime, DepDelay, ArrDelay, CRSElapsedTime, Cancelled, Diverted

Decisiones de diseno
    * salida_prevista  = FlightDate + CRSDepTime (hora LOCAL del origen) pasada a UTC.
    * llegada_prevista = salida_prevista + CRSElapsedTime. Asi no hace falta la zona horaria
      del destino ni arreglar cruces de medianoche, y se cumple siempre llegada > salida.
    * salida_real / llegada_real = prevista + DepDelay / ArrDelay (minutos). NULL si cancelado.
    * estado: cancelado | retrasado (DepDelay >= 15) | aterrizado. Los otros tres valores del
      ENUM (programado, embarcando, en_vuelo) no existen en datos historicos.
    * Vuelos desviados: se excluyen (el ENUM no tiene estado para ellos).
    * Puerta y pista de ORIGEN: al azar entre las del aeropuerto (semilla 42), NULL si no hay.
"""
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# ----------------------------------------------------------------------------------------
# 0. CONFIGURACION
# ----------------------------------------------------------------------------------------
BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
RAW = BASE / "raw_data"
DATA = BASE / "data"

BTS_GLOB = "bts*.csv"                      # raw_data/bts_ontime_2025_09.csv, ...
FICHERO_TZ = RAW / "airports_mod.dat"      # OpenFlights con zona horaria Olson
SEED = 42
UMBRAL_RETRASO_MIN = 15                    # >= 15 min de retraso en salida => 'retrasado'
EXCLUIR_DESVIADOS = True
EXIGIR_MISMA_AEROLINEA = True              # la aeronave debe pertenecer a la aerolinea del vuelo
AMPLIAR_RUTA = True                        # anadir a ruta los pares del BTS que no esten
# Como se escriben los NULL en el CSV. Mira como lo hace tu data/vuelo.csv actual
# (p. ej. las filas con id_puerta vacio) y copia ese formato: "" o "\\N".
NA_REP = "\\N"

COLS_BTS = [
    "FlightDate", "Reporting_Airline", "Flight_Number_Reporting_Airline", "Tail_Number",
    "Origin", "Dest", "CRSDepTime", "DepDelay", "ArrDelay", "CRSElapsedTime",
    "Cancelled", "Diverted",
]
# El BTS publica los mismos campos con nombres largos (FlightDate) o cortos (FL_DATE).
# El script los acepta en cualquier mayuscula/minuscula y los renombra a los largos.
ALIAS_BTS = {
    "FlightDate": ["FlightDate", "FL_DATE"],
    "Reporting_Airline": ["Reporting_Airline", "OP_UNIQUE_CARRIER", "OP_CARRIER", "UNIQUE_CARRIER"],
    "Flight_Number_Reporting_Airline": ["Flight_Number_Reporting_Airline", "OP_CARRIER_FL_NUM", "FL_NUM"],
    "Tail_Number": ["Tail_Number", "TAIL_NUM", "TAIL_NUMBER"],
    "Origin": ["Origin", "ORIGIN"],
    "Dest": ["Dest", "DEST"],
    "CRSDepTime": ["CRSDepTime", "CRS_DEP_TIME"],
    "DepDelay": ["DepDelay", "DEP_DELAY"],
    "ArrDelay": ["ArrDelay", "ARR_DELAY"],
    "CRSElapsedTime": ["CRSElapsedTime", "CRS_ELAPSED_TIME"],
    "Cancelled": ["Cancelled", "CANCELLED"],
    "Diverted": ["Diverted", "DIVERTED"],
}
# Opcionales: no son columnas de vuelo, pero se guardan aparte en raw_data/vuelo_extra_bts.csv
# (clave id_vuelo) para las features de la Torre de Control (p. ej. LateAircraftDelay = cascada).
ALIAS_EXTRA = {
    "CancellationCode": ["CancellationCode", "CANCELLATION_CODE"],
    "Distance": ["Distance", "DISTANCE"],                       # millas
    "CarrierDelay": ["CarrierDelay", "CARRIER_DELAY"],
    "WeatherDelay": ["WeatherDelay", "WEATHER_DELAY"],
    "NASDelay": ["NASDelay", "NAS_DELAY"],
    "SecurityDelay": ["SecurityDelay", "SECURITY_DELAY"],
    "LateAircraftDelay": ["LateAircraftDelay", "LATE_AIRCRAFT_DELAY"],
}
COLUMNAS_VUELO = [
    "id_vuelo", "numero_vuelo", "id_ruta", "id_aeronave", "id_puerta", "id_pista",
    "salida_prevista", "llegada_prevista", "salida_real", "llegada_real", "estado",
]


# ----------------------------------------------------------------------------------------
# Utilidades
# ----------------------------------------------------------------------------------------
def col(df, candidatos, tabla):
    """Devuelve el primer nombre de columna que exista; si ninguno, para con un error claro."""
    for c in candidatos:
        if c in df.columns:
            return c
    sys.exit(
        f"[{tabla}] no encuentro ninguna de estas columnas: {candidatos}\n"
        f"   columnas reales: {list(df.columns)}\n"
        f"   -> anade el nombre real a la lista de candidatos en el script."
    )


def paso(msg, antes, despues):
    print(f"  {msg}: {antes:,} -> {despues:,}  ({antes - despues:,} descartadas)")


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


def asignar_aleatorio(df, col_aeropuerto, dic, rng):
    """Para cada fila elige al azar un id de dic[aeropuerto]; <NA> si el aeropuerto no tiene."""
    res = pd.Series(pd.NA, index=df.index, dtype="Int64")
    for aid, idx in sorted(df.groupby(col_aeropuerto).groups.items()):
        opciones = dic.get(aid)
        if opciones is not None and len(opciones) > 0:
            res.loc[idx] = rng.choice(opciones, size=len(idx))
    return res


# ----------------------------------------------------------------------------------------
# 1. LEER BTS
# ----------------------------------------------------------------------------------------
print("1. Leyendo BTS")
ficheros = sorted(RAW.glob(BTS_GLOB))
if not ficheros:
    sys.exit(f"No hay ficheros {RAW / BTS_GLOB}. Guarda la descarga del BTS en raw_data/ como bts_*.csv")

partes = []
for f in ficheros:
    cabecera = list(pd.read_csv(f, nrows=0).columns)
    en_minusc = {c.strip().lower(): c for c in cabecera}
    reales, faltan = {}, []                      # nombre real en el CSV -> nombre canonico
    for canonico in COLS_BTS:
        hallada = next((en_minusc[a.lower()] for a in ALIAS_BTS[canonico] if a.lower() in en_minusc), None)
        if hallada is None:
            faltan.append(canonico)
        else:
            reales[hallada] = canonico
    if faltan:
        sys.exit(f"{f.name}: no encuentro {faltan}.\n   cabecera real: {cabecera}\n"
                 f"   -> anade el nombre real a ALIAS_BTS o vuelve a descargar marcando esas columnas.")
    extras = {}                                  # columnas opcionales (causas de retraso, etc.)
    for canonico, alias in ALIAS_EXTRA.items():
        hallada = next((en_minusc[a.lower()] for a in alias if a.lower() in en_minusc), None)
        if hallada is not None:
            extras[hallada] = canonico
    parte = pd.read_csv(f, usecols=list(reales) + list(extras), low_memory=False).rename(columns={**reales, **extras})
    partes.append(parte)
    print(f"  {f.name}: {len(parte):,} filas")
bts = pd.concat(partes, ignore_index=True)
n0 = len(bts)

# ----------------------------------------------------------------------------------------
# 2. LIMPIEZA BASICA
# ----------------------------------------------------------------------------------------
print("2. Limpieza")
bts["cancelado"] = bts["Cancelled"].fillna(0).astype(float).eq(1)
bts["desviado"] = bts["Diverted"].fillna(0).astype(float).eq(1)

n = len(bts)
if EXCLUIR_DESVIADOS:
    bts = bts[~bts["desviado"]]
    paso("sin desviados", n, len(bts))

n = len(bts)
bts = bts.dropna(subset=["FlightDate", "Reporting_Airline", "Flight_Number_Reporting_Airline",
                         "Origin", "Dest", "CRSDepTime", "CRSElapsedTime"])
bts = bts[bts["CRSElapsedTime"] > 0]
paso("campos obligatorios y duracion > 0", n, len(bts))

n = len(bts)
bts = bts[bts["cancelado"] | (bts["DepDelay"].notna() & bts["ArrDelay"].notna())]
paso("no cancelados con retrasos informados", n, len(bts))

n = len(bts)
bts["Tail_Number"] = bts["Tail_Number"].astype("string").str.strip().str.upper()
bts = bts[bts["Tail_Number"].notna() & (bts["Tail_Number"] != "")]
paso("con matricula (id_aeronave es NOT NULL)", n, len(bts))

bts["Reporting_Airline"] = bts["Reporting_Airline"].astype(str).str.strip().str.upper()
bts["numero_vuelo"] = bts["Reporting_Airline"] + bts["Flight_Number_Reporting_Airline"].astype(int).astype(str)
bts = bts.reset_index(drop=True)

# ----------------------------------------------------------------------------------------
# 3. AEROPUERTOS: IATA -> id y zona horaria
# ----------------------------------------------------------------------------------------
print("3. Aeropuertos y zonas horarias")
ap = pd.read_csv(DATA / "aeropuerto.csv", keep_default_na=False, na_values=[""])
ap_id = col(ap, ["id_aeropuerto", "id"], "aeropuerto")
ap_iata = col(ap, ["codigo_iata", "iata", "iata_faa", "codigo_iata_faa"], "aeropuerto")
ap_lat = col(ap, ["latitud", "lat"], "aeropuerto")
ap_lon = col(ap, ["longitud", "lon", "lng"], "aeropuerto")
ap["_iata"] = ap[ap_iata].astype("string").str.strip().str.upper()
ap = ap.dropna(subset=["_iata"]).drop_duplicates("_iata")
mapa_ap = ap.set_index("_iata")[ap_id]

def leer_zonas_horarias(ruta_dat):
    """Lee airports_mod.dat contando los campos DESDE LA DERECHA.
    Algunas filas traen comas sin entrecomillar en el nombre o la ciudad (13 campos en vez de 12);
    los 8 ultimos campos son fijos: iata, icao, lat, lon, alt, tz_offset, dst, tz Olson."""
    import csv
    filas, irregulares = [], 0
    with open(ruta_dat, encoding="utf-8", errors="replace", newline="") as fh:
        for r in csv.reader(fh):
            if len(r) < 12:
                continue
            if len(r) != 12:
                irregulares += 1
            filas.append((r[-8].strip().upper(), r[-1].strip()))
    if irregulares:
        print(f"  {irregulares} filas de {ruta_dat.name} con campos de mas (comas en el nombre): leidas por la derecha")
    df = pd.DataFrame(filas, columns=["iata", "tz"])
    df = df[~df["iata"].isin(["", "\\N", "N/A"]) & ~df["tz"].isin(["", "\\N"])]
    return df.drop_duplicates("iata").set_index("iata")["tz"]


mapa_tz = leer_zonas_horarias(FICHERO_TZ)

n = len(bts)
bts["id_origen"] = bts["Origin"].map(mapa_ap)
bts["id_destino"] = bts["Dest"].map(mapa_ap)
sin_ap = bts[bts["id_origen"].isna() | bts["id_destino"].isna()]
if len(sin_ap):
    codigos = pd.concat([sin_ap.loc[sin_ap["id_origen"].isna(), "Origin"],
                         sin_ap.loc[sin_ap["id_destino"].isna(), "Dest"]]).value_counts().head(8)
    print(f"  IATA que no estan en aeropuerto.csv (top): {codigos.to_dict()}")
bts = bts.dropna(subset=["id_origen", "id_destino"])
bts = bts[bts["id_origen"] != bts["id_destino"]]
bts[["id_origen", "id_destino"]] = bts[["id_origen", "id_destino"]].astype(int)
paso("origen y destino existen en aeropuerto", n, len(bts))

n = len(bts)
bts["tz"] = bts["Origin"].map(mapa_tz)
bts = bts.dropna(subset=["tz"]).reset_index(drop=True)
paso("origen con zona horaria conocida", n, len(bts))

# ----------------------------------------------------------------------------------------
# 4. FECHAS: hora local del origen -> UTC
# ----------------------------------------------------------------------------------------
print("4. Fechas a UTC")
def parsear_fecha(serie):
    """FlightDate llega como 2025-08-01, 20250801 o 1/1/2026 (m/d/aaaa, con o sin hora '12:00:00 AM').
    Prueba cada formato y se queda con el que lee mas filas."""
    texto = serie.astype(str).str.strip().str.split(" ").str[0]
    mejor = None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
        res = pd.to_datetime(texto, format=fmt, errors="coerce")
        if mejor is None or res.notna().sum() > mejor[1].notna().sum():
            mejor = (fmt, res)
    if mejor[1].notna().mean() < 0.99:
        sys.exit(f"No entiendo el formato de FlightDate. Ejemplos: {texto.drop_duplicates().head(5).tolist()}")
    print(f"  formato de FlightDate: {mejor[0]}")
    return mejor[1]


fecha = parsear_fecha(bts["FlightDate"])
n = len(bts)
bts = bts[fecha.notna()].reset_index(drop=True)
fecha = fecha[fecha.notna()].reset_index(drop=True)
paso("FlightDate valida", n, len(bts))
print(f"  vuelos del {fecha.min():%d/%m/%Y} al {fecha.max():%d/%m/%Y}")

t = bts["CRSDepTime"].astype(int)
minutos_dia = (t // 100) * 60 + (t % 100)             # 2400 -> 1440 min = 00:00 del dia siguiente
local = fecha + pd.to_timedelta(minutos_dia, unit="m")

trozos = []
try:
    for tz, idx in bts.groupby("tz").groups.items():
        loc = local.loc[idx].dt.tz_localize(tz, ambiguous="NaT", nonexistent="shift_forward")
        trozos.append(loc.dt.tz_convert("UTC").dt.tz_localize(None))
except Exception as e:  # zona desconocida: en Windows suele faltar el paquete tzdata
    sys.exit(f"Error con la zona horaria: {e}\n   -> prueba: pip install tzdata")
bts["salida_prevista"] = pd.concat(trozos).reindex(bts.index)

n = len(bts)
bts = bts.dropna(subset=["salida_prevista"]).reset_index(drop=True)   # horas ambiguas por cambio de hora
paso("hora local valida (cambio de hora)", n, len(bts))

bts["llegada_prevista"] = bts["salida_prevista"] + pd.to_timedelta(bts["CRSElapsedTime"], unit="m")

# ----------------------------------------------------------------------------------------
# 5. RUTA: id_ruta por (origen, destino); ampliar con los pares que falten
# ----------------------------------------------------------------------------------------
print("5. Ruta")
ruta = pd.read_csv(DATA / "ruta.csv")
r_id = col(ruta, ["id_ruta", "id"], "ruta")
r_o = col(ruta, ["id_aeropuerto_origen", "id_origen", "origen_id", "id_aeropuerto_salida", "origen"], "ruta")
r_d = col(ruta, ["id_aeropuerto_destino", "id_destino", "destino_id", "id_aeropuerto_llegada", "destino"], "ruta")
r_dist = next((c for c in ["distancia_km", "distancia"] if c in ruta.columns), None)

pares = bts[["id_origen", "id_destino"]].drop_duplicates()
existentes = ruta[[r_o, r_d]].rename(columns={r_o: "id_origen", r_d: "id_destino"}).drop_duplicates()
faltan = pares.merge(existentes, how="left", indicator=True)
faltan = faltan[faltan["_merge"] == "left_only"].drop(columns="_merge")
print(f"  pares distintos en BTS: {len(pares):,}; ya en ruta: {len(pares) - len(faltan):,}; faltan: {len(faltan):,}")

if AMPLIAR_RUTA and len(faltan):
    copia = RAW / "ruta_antes_bts.csv"
    if not copia.exists():
        shutil.copy(DATA / "ruta.csv", copia)               # copia de seguridad (solo la primera vez)
    coords = ap.set_index(ap_id)[[ap_lat, ap_lon]]
    nuevas = faltan.copy()
    nuevas[r_id] = np.arange(ruta[r_id].max() + 1, ruta[r_id].max() + 1 + len(nuevas))
    nuevas[r_o] = nuevas["id_origen"]
    nuevas[r_d] = nuevas["id_destino"]
    if r_dist:
        la1 = coords.loc[nuevas["id_origen"], ap_lat].to_numpy()
        lo1 = coords.loc[nuevas["id_origen"], ap_lon].to_numpy()
        la2 = coords.loc[nuevas["id_destino"], ap_lat].to_numpy()
        lo2 = coords.loc[nuevas["id_destino"], ap_lon].to_numpy()
        nuevas[r_dist] = np.maximum(1, np.round(haversine_km(la1, lo1, la2, lo2))).astype(int)
    nuevas = nuevas.reindex(columns=ruta.columns)
    vacias = [c for c in nuevas.columns if nuevas[c].isna().all()]
    if vacias:
        print(f"  AVISO: ruta tiene otras columnas que quedan vacias en las rutas nuevas: {vacias}. "
              f"Si son NOT NULL en MySQL, rellenalas aqui.")
    ruta = pd.concat([ruta, nuevas], ignore_index=True)
    ruta.to_csv(DATA / "ruta.csv", index=False)
    print(f"  ruta.csv: +{len(nuevas):,} rutas nuevas (copia previa en {copia.name})")

mapa_ruta = ruta[[r_id, r_o, r_d]].rename(columns={r_id: "id_ruta", r_o: "id_origen", r_d: "id_destino"})
mapa_ruta = mapa_ruta.drop_duplicates(["id_origen", "id_destino"])
n = len(bts)
bts = bts.merge(mapa_ruta, on=["id_origen", "id_destino"], how="inner")
paso("con ruta", n, len(bts))

# ----------------------------------------------------------------------------------------
# 6. AERONAVE y AEROLINEA
# ----------------------------------------------------------------------------------------
print("6. Aeronave y aerolinea")
ae = pd.read_csv(DATA / "aeronave.csv", keep_default_na=False, na_values=[""])
ae_id = col(ae, ["id_aeronave", "id"], "aeronave")
ae_mat = col(ae, ["matricula", "registro", "registration"], "aeronave")
ae_aero = col(ae, ["id_aerolinea"], "aeronave")
ae["_mat"] = ae[ae_mat].astype("string").str.strip().str.upper()
ae = ae.dropna(subset=["_mat"]).drop_duplicates("_mat")
ae = ae[[ae_id, ae_aero, "_mat"]].rename(columns={ae_id: "id_aeronave", ae_aero: "id_aerolinea_aeronave"})

n = len(bts)
bts = bts.merge(ae, left_on="Tail_Number", right_on="_mat", how="inner")
paso("matricula existe en aeronave", n, len(bts))

al = pd.read_csv(DATA / "aerolinea.csv", keep_default_na=False, na_values=[""])
al_id = col(al, ["id_aerolinea", "id"], "aerolinea")
al_iata = col(al, ["codigo_iata", "iata"], "aerolinea")
al_act = next((c for c in ["activa", "activo"] if c in al.columns), None)
al["_iata"] = al[al_iata].astype("string").str.strip().str.upper()
al["_activa"] = (al[al_act].astype(str).str.strip().str.upper().isin(["Y", "1", "TRUE", "S", "SI"])
                 if al_act else True)
al = al.dropna(subset=["_iata"]).sort_values("_activa", ascending=False, kind="stable")
mapa_al = al.drop_duplicates("_iata").set_index("_iata")[al_id]          # IATA duplicado: gana la activa
bts["id_aerolinea_vuelo"] = bts["Reporting_Airline"].map(mapa_al)

if EXIGIR_MISMA_AEROLINEA:
    n = len(bts)
    bts = bts[bts["id_aerolinea_vuelo"].eq(bts["id_aerolinea_aeronave"])]
    paso("aeronave de la misma aerolinea que el vuelo", n, len(bts))

# ----------------------------------------------------------------------------------------
# 7. ESTADO y TIEMPOS REALES
# ----------------------------------------------------------------------------------------
print("7. Estado y tiempos reales")
bts = bts.reset_index(drop=True)
bts["estado"] = np.select(
    [bts["cancelado"], bts["DepDelay"] >= UMBRAL_RETRASO_MIN],
    ["cancelado", "retrasado"],
    default="aterrizado",
)
vuela = ~bts["cancelado"]
bts["salida_real"] = (bts["salida_prevista"] + pd.to_timedelta(bts["DepDelay"], unit="m")).where(vuela)
bts["llegada_real"] = (bts["llegada_prevista"] + pd.to_timedelta(bts["ArrDelay"], unit="m")).where(vuela)

n = len(bts)
incoherente = vuela & (bts["llegada_real"] <= bts["salida_real"])
bts = bts[~incoherente].reset_index(drop=True)
paso("llegada_real > salida_real", n, len(bts))

# ----------------------------------------------------------------------------------------
# 8. PUERTA y PISTA (origen, al azar; NULL si el aeropuerto no tiene datos)
# ----------------------------------------------------------------------------------------
print("8. Puerta y pista")
rng = np.random.default_rng(SEED)

te = pd.read_csv(DATA / "terminal.csv")
te_id = col(te, ["id_terminal", "id"], "terminal")
te_ap = col(te, ["id_aeropuerto"], "terminal")
pe = pd.read_csv(DATA / "puerta_embarque.csv")
pe_id = col(pe, ["id_puerta", "id"], "puerta_embarque")
pe_te = col(pe, ["id_terminal"], "puerta_embarque")
pe = pe.merge(te[[te_id, te_ap]].rename(columns={te_id: "_id_terminal", te_ap: "_id_aeropuerto"}),
              left_on=pe_te, right_on="_id_terminal", how="inner")
puertas = pe.groupby("_id_aeropuerto")[pe_id].apply(lambda s: s.to_numpy()).to_dict()

pi = pd.read_csv(DATA / "pista.csv")
pi_id = col(pi, ["id_pista", "id"], "pista")
pi_ap = col(pi, ["id_aeropuerto"], "pista")
pistas = pi.groupby(pi_ap)[pi_id].apply(lambda s: s.to_numpy()).to_dict()

bts["id_puerta"] = asignar_aleatorio(bts, "id_origen", puertas, rng)
bts["id_pista"] = asignar_aleatorio(bts, "id_origen", pistas, rng)
print(f"  con puerta: {bts['id_puerta'].notna().mean():.1%}; con pista: {bts['id_pista'].notna().mean():.1%}")

# ----------------------------------------------------------------------------------------
# 9. ENSAMBLAR, UNIQUE (numero_vuelo, salida_prevista), IDs y ESCRIBIR
# ----------------------------------------------------------------------------------------
print("9. Ensamblar y escribir")
out = bts[["numero_vuelo", "id_ruta", "id_aeronave", "id_puerta", "id_pista",
           "salida_prevista", "llegada_prevista", "salida_real", "llegada_real", "estado"]].copy()
out = out.sort_values(["salida_prevista", "numero_vuelo"], kind="stable")

n = len(out)
out = out.drop_duplicates(["numero_vuelo", "salida_prevista"], keep="first")
paso("UNIQUE (numero_vuelo, salida_prevista)", n, len(out))

out[["id_ruta", "id_aeronave"]] = out[["id_ruta", "id_aeronave"]].astype(int)
out.insert(0, "id_vuelo", np.arange(1, len(out) + 1))

# Datos extra del BTS (causas de retraso, codigo de cancelacion, distancia) con la misma id_vuelo
cols_extra = [c for c in ALIAS_EXTRA if c in bts.columns]
if cols_extra:
    extra = bts.loc[out.index, cols_extra].copy()
    extra.insert(0, "id_vuelo", out["id_vuelo"])
    extra.to_csv(RAW / "vuelo_extra_bts.csv", index=False, na_rep=NA_REP)
    print(f"  extra: {len(extra):,} filas con {cols_extra} -> raw_data/vuelo_extra_bts.csv")

# Comprobaciones previas a escribir (reflejan el CREATE TABLE)
assert (out["llegada_prevista"] > out["salida_prevista"]).all(), "CHECK llegada_prevista > salida_prevista"
assert out["numero_vuelo"].str.len().max() <= 10, "numero_vuelo > VARCHAR(10)"
assert not out.duplicated(["numero_vuelo", "salida_prevista"]).any(), "UNIQUE uq_vuelo"
assert out["estado"].isin(["programado", "embarcando", "en_vuelo", "aterrizado", "retrasado", "cancelado"]).all()
assert out["id_ruta"].isin(ruta[r_id]).all(), "FK id_ruta"
assert out["id_aeronave"].isin(pd.read_csv(DATA / "aeronave.csv")[ae_id]).all(), "FK id_aeronave"

for c in ["salida_prevista", "llegada_prevista", "salida_real", "llegada_real"]:
    out[c] = out[c].dt.strftime("%Y-%m-%d %H:%M:%S")          # NaT -> NaN -> NA_REP

destino = DATA / "vuelo.csv"
if destino.exists() and not (RAW / "vuelo_nycflights13.csv").exists():
    shutil.copy(destino, RAW / "vuelo_nycflights13.csv")        # copia del vuelo.csv anterior
out[COLUMNAS_VUELO].to_csv(destino, index=False, na_rep=NA_REP)

print(f"\nOK -> {destino}  ({len(out):,} vuelos de {n0:,} filas BTS: {len(out) / n0:.1%})")
print(f"   salida_prevista UTC: {out['salida_prevista'].min()}  ..  {out['salida_prevista'].max()}")
print("   estado:", out["estado"].value_counts(normalize=True).round(3).to_dict())
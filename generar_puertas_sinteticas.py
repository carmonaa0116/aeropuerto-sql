"""
generar_puertas_sinteticas.py  --  rellena id_puerta de vuelo.csv con puertas SINTETICAS sin solapes

Ejecutar DESPUES de generar_vuelo.py y ANTES de los demas generar_*.py y del cargador:
    python generar_puertas_sinteticas.py            # usa ./data y ./raw_data
    python generar_puertas_sinteticas.py <carpeta>  # raiz del proyecto en otra ruta

Que hace
    1. Para cada aeropuerto de ORIGEN con vuelos, calcula cuantas puertas hacen falta a la vez (pico de
       ocupacion) y crea las que falten (A1..A30, B1..B30...) con una terminal "Terminal 1" si no tiene.
       Las puertas reales que ya existan (OpenStreetMap) se conservan y se usan primero.
    2. Asigna a cada vuelo una puerta libre al azar (semilla 42). Una puerta nunca tiene dos vuelos a la vez.
       Ocupacion de un vuelo = [salida_prevista - ANTES_MIN, max(salida_prevista, salida_real) + DESPUES_MIN].
    3. Reescribe data/vuelo.csv (id_puerta), data/puerta_embarque.csv y data/terminal.csv, con copia previa
       en raw_data/*_antes_puertas.csv (solo la primera vez).

Los datos nuevos son SINTETICOS: el BTS no trae puerta de embarque.
"""
import heapq
import shutil
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# ------------------------------------------------------------------ configuracion
BASE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
RAW, DATA = BASE / "raw_data", BASE / "data"
SEED = 42
ANTES_MIN = 45          # la puerta se ocupa 45 min antes de la salida prevista
DESPUES_MIN = 10        # y se libera 10 min despues de la salida (real si es posterior)
MARGEN = 1.25           # puertas = pico de ocupacion x 1,25 (para repartir el uso)
MIN_PUERTAS = 3
PUERTAS_POR_PASILLO = 30
NA_REP = "\\N"          # como escribes los NULL en tus CSV (igual que en generar_vuelo.py)


def col(df, candidatos, tabla):
    for c in candidatos:
        if c in df.columns:
            return c
    sys.exit(f"[{tabla}] no encuentro ninguna de {candidatos}\n   columnas reales: {list(df.columns)}\n"
             f"   -> anade el nombre real a la lista de candidatos en el script.")


def leer(nombre):
    """Lee un CSV como texto puro (se conservan tal cual los valores y los NULL que ya tenia)."""
    return pd.read_csv(DATA / nombre, dtype=str, keep_default_na=False)


def respaldo(nombre):
    destino = RAW / (Path(nombre).stem + "_antes_puertas.csv")
    if not destino.exists():
        shutil.copy(DATA / nombre, destino)


def codigo_puerta(k):
    """k=0 -> A1, k=29 -> A30, k=30 -> B1 ... (pasillos A..Z, luego AA, AB...)."""
    p, n = divmod(k, PUERTAS_POR_PASILLO)
    letra = chr(65 + p) if p < 26 else chr(64 + p // 26) + chr(65 + p % 26)
    return f"{letra}{n + 1}"


def pico_ocupacion(ini, fin):
    """Maximo de intervalos [ini, fin) solapados a la vez."""
    ev = np.concatenate([np.stack([ini, np.ones_like(ini)], 1), np.stack([fin, -np.ones_like(fin)], 1)])
    ev = ev[np.lexsort((ev[:, 1], ev[:, 0]))]        # a igual instante, primero las salidas (-1)
    return int(np.cumsum(ev[:, 1]).max())


def asignar(ini, fin, n_puertas, rng):
    """Devuelve el indice de puerta (0..n_puertas-1) de cada vuelo, eligiendo al azar entre las libres."""
    orden = np.argsort(ini, kind="stable")
    libres, ocupadas = list(range(n_puertas)), []
    res = np.empty(len(ini), dtype=np.int64)
    for i in orden:
        while ocupadas and ocupadas[0][0] <= ini[i]:
            libres.append(heapq.heappop(ocupadas)[1])
        j = int(rng.integers(len(libres)))
        g = libres[j]
        libres[j] = libres[-1]
        libres.pop()
        heapq.heappush(ocupadas, (fin[i], g))
        res[i] = g
    return res


# ------------------------------------------------------------------ 1. leer tablas
print("1. Leyendo tablas")
vuelo = leer("vuelo.csv")
ruta = leer("ruta.csv")
terminal = leer("terminal.csv")
puerta = leer("puerta_embarque.csv")

r_id = col(ruta, ["id_ruta", "id"], "ruta")
r_o = col(ruta, ["id_aeropuerto_origen", "id_origen", "origen_id", "id_aeropuerto_salida", "origen"], "ruta")
t_id = col(terminal, ["id_terminal", "id"], "terminal")
t_ap = col(terminal, ["id_aeropuerto"], "terminal")
t_nom = col(terminal, ["nombre", "codigo", "descripcion"], "terminal")
p_id = col(puerta, ["id_puerta", "id"], "puerta_embarque")
p_term = col(puerta, ["id_terminal"], "puerta_embarque")
p_cod = col(puerta, ["codigo", "codigo_puerta", "puerta", "ref", "nombre"], "puerta_embarque")

vuelo["_orig"] = vuelo["id_ruta"].map(ruta.set_index(r_id)[r_o])
if vuelo["_orig"].isna().any():
    sys.exit(f"{vuelo['_orig'].isna().sum()} vuelos con id_ruta que no esta en ruta.csv: ejecuta antes generar_vuelo.py.")
vuelo["_ini"] = (pd.to_datetime(vuelo["salida_prevista"]) - pd.Timedelta(minutes=ANTES_MIN))
real = pd.to_datetime(vuelo["salida_real"].replace(NA_REP, pd.NA), errors="coerce")
vuelo["_fin"] = pd.concat([pd.to_datetime(vuelo["salida_prevista"]), real], axis=1).max(axis=1) + pd.Timedelta(minutes=DESPUES_MIN)
epoch = pd.Timestamp("1970-01-01")
vuelo["_ini"] = ((vuelo["_ini"] - epoch) // pd.Timedelta(minutes=1)).astype("int64")
vuelo["_fin"] = ((vuelo["_fin"] - epoch) // pd.Timedelta(minutes=1)).astype("int64")
print(f"  {len(vuelo):,} vuelos en {vuelo['_orig'].nunique():,} aeropuertos de origen")

# ------------------------------------------------------------------ 2. puertas por aeropuerto
print("2. Calculando y asignando puertas")
rng = np.random.default_rng(SEED)
sig_term = int(terminal[t_id].astype(int).max()) + 1
sig_puerta = int(puerta[p_id].astype(int).max()) + 1
terminales_nuevas, puertas_nuevas = [], []
puerta_de_vuelo = pd.Series(index=vuelo.index, dtype="object")
resumen = []

terminales_de = terminal.groupby(t_ap)[t_id].apply(lambda s: sorted(s.astype(int))).to_dict()
for aid, grupo in sorted(vuelo.groupby("_orig"), key=lambda kv: str(kv[0])):
    ini, fin = grupo["_ini"].to_numpy(), grupo["_fin"].to_numpy()
    necesarias = max(MIN_PUERTAS, int(np.ceil(pico_ocupacion(ini, fin) * MARGEN)))

    terms = terminales_de.get(aid)
    if not terms:                                                     # aeropuerto sin terminal: se crea una
        terminales_nuevas.append({t_id: str(sig_term), t_ap: aid, t_nom: "Terminal 1"})
        terms, terminales_de[aid] = [sig_term], [sig_term]
        sig_term += 1
    ids_term = {str(x) for x in terms}
    pool = puerta.loc[puerta[p_term].isin(ids_term), p_id].astype(int).tolist()    # puertas reales existentes
    codigos = set(puerta.loc[puerta[p_term] == str(terms[0]), p_cod])
    k = 0
    while len(pool) < necesarias:                                     # crear las que falten (sinteticas)
        cod = codigo_puerta(k)
        k += 1
        if cod in codigos:
            continue
        codigos.add(cod)
        puertas_nuevas.append({p_id: str(sig_puerta), p_term: str(terms[0]), p_cod: cod, "_aid": aid})
        pool.append(sig_puerta)
        sig_puerta += 1
    idx = asignar(ini, fin, len(pool), rng)
    puerta_de_vuelo.loc[grupo.index] = [pool[i] for i in idx]
    resumen.append((aid, len(grupo), len(pool)))

# ------------------------------------------------------------------ 3. verificar y escribir
print("3. Verificando")
v = pd.DataFrame({"g": puerta_de_vuelo.astype(int), "ini": vuelo["_ini"], "fin": vuelo["_fin"]}).sort_values(["g", "ini"])
fin_prev = v.groupby("g")["fin"].shift()
solapes = int((v["ini"] < fin_prev).sum())
assert puerta_de_vuelo.notna().all(), "quedan vuelos sin puerta"
assert solapes == 0, f"{solapes} solapes de puerta"
print(f"  vuelos con puerta: {len(vuelo):,} (100 %); solapes de puerta: {solapes}")

nuevas_t = pd.DataFrame(terminales_nuevas, columns=terminal.columns).fillna(NA_REP)
nuevas_p = pd.DataFrame(puertas_nuevas, columns=list(puerta.columns) + ["_aid"])
# Si puerta_embarque tiene coordenadas, las nuevas puertas se colocan cerca del aeropuerto (+-150 m aprox.)
p_lat = next((c for c in ("latitud", "lat") if c in puerta.columns), None)
p_lon = next((c for c in ("longitud", "lon", "lng") if c in puerta.columns), None)
if p_lat and p_lon and len(nuevas_p):
    aero = leer("aeropuerto.csv")
    a_id = col(aero, ["id_aeropuerto", "id"], "aeropuerto")
    a_lat = col(aero, ["latitud", "lat"], "aeropuerto")
    a_lon = col(aero, ["longitud", "lon", "lng"], "aeropuerto")
    centro = aero.set_index(a_id)[[a_lat, a_lon]].apply(pd.to_numeric, errors="coerce")
    lat0 = nuevas_p["_aid"].map(centro[a_lat]).to_numpy(dtype=float)
    lon0 = nuevas_p["_aid"].map(centro[a_lon]).to_numpy(dtype=float)
    nuevas_p[p_lat] = [f"{x:.6f}" for x in lat0 + rng.normal(0, 0.0015, len(nuevas_p))]
    nuevas_p[p_lon] = [f"{x:.6f}" for x in lon0 + rng.normal(0, 0.0015, len(nuevas_p))]
nuevas_p = nuevas_p.drop(columns="_aid").fillna(NA_REP)
otras_t = [c for c in terminal.columns if c not in (t_id, t_ap, t_nom)]
otras_p = [c for c in puerta.columns if c not in (p_id, p_term, p_cod, p_lat, p_lon)]
if (len(nuevas_t) and otras_t) or (len(nuevas_p) and otras_p):
    print(f"  AVISO: las filas nuevas dejan en {NA_REP} estas columnas: terminal {otras_t}, puerta_embarque {otras_p}. "
          f"Si son NOT NULL en MySQL, rellenalas en este script.")

for nombre in ("vuelo.csv", "puerta_embarque.csv", "terminal.csv"):
    respaldo(nombre)
vuelo["id_puerta"] = puerta_de_vuelo.astype(int).astype(str)
vuelo.drop(columns=["_orig", "_ini", "_fin"]).to_csv(DATA / "vuelo.csv", index=False)
pd.concat([puerta, nuevas_p], ignore_index=True).to_csv(DATA / "puerta_embarque.csv", index=False)
pd.concat([terminal, nuevas_t], ignore_index=True).to_csv(DATA / "terminal.csv", index=False)

print(f"\nOK -> {len(nuevas_p):,} puertas nuevas y {len(nuevas_t):,} terminales nuevas; vuelo.csv con id_puerta en todos los vuelos")
print("   Top aeropuertos (id_aeropuerto, vuelos, puertas):", sorted(resumen, key=lambda r: -r[1])[:5])
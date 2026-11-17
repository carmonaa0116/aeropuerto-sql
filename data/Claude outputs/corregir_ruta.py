from pathlib import Path
import shutil

import numpy as np
import pandas as pd

# 1. Definir rutas
carpeta_raw = Path("raw_data")
carpeta_data = Path("data")
carpeta_raw.mkdir(parents=True, exist_ok=True)

ruta_ruta_csv = carpeta_data / "ruta.csv"
ruta_aeropuerto_csv = carpeta_data / "aeropuerto.csv"
ruta_copia = carpeta_raw / "ruta_original.csv"

for ruta in (ruta_ruta_csv, ruta_aeropuerto_csv):
    if not ruta.exists():
        raise FileNotFoundError(f"Falta '{ruta}'.")

RADIO_TIERRA_KM = 6371

# 2. Copia de seguridad del ruta.csv original (solo la primera vez)
if not ruta_copia.exists():
    shutil.copy(ruta_ruta_csv, ruta_copia)

# 3. Leer siempre desde la copia original, así el script se puede repetir
df = pd.read_csv(ruta_copia)
df_aero = pd.read_csv(ruta_aeropuerto_csv, usecols=["id_aeropuerto", "latitud", "longitud"]).set_index("id_aeropuerto")
n_inicial = len(df)

# 4. Quitar rutas cuyo origen o destino no está en aeropuerto.csv (aeropuertos de OpenFlights sin IATA/ICAO válido)
existe = df["id_aeropuerto_origen"].isin(df_aero.index) & df["id_aeropuerto_destino"].isin(df_aero.index)
n_sin_aeropuerto = int((~existe).sum())
df = df[existe].copy()

# 5. Calcular distancia_km con Haversine (el CSV original traía un 1 en todas las filas)
o = df_aero.loc[df["id_aeropuerto_origen"]]
d = df_aero.loc[df["id_aeropuerto_destino"]]
la1, lo1 = np.radians(o["latitud"].to_numpy()), np.radians(o["longitud"].to_numpy())
la2, lo2 = np.radians(d["latitud"].to_numpy()), np.radians(d["longitud"].to_numpy())
h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
df["distancia_km"] = np.maximum(1, np.rint(2 * RADIO_TIERRA_KM * np.arcsin(np.sqrt(h)))).astype(int)  # CHECK (distancia_km > 0)

# 6. Respetar la UNIQUE (origen, destino) y el CHECK origen <> destino
df = df[df["id_aeropuerto_origen"] != df["id_aeropuerto_destino"]]
df = df.drop_duplicates(subset=["id_aeropuerto_origen", "id_aeropuerto_destino"])

# 7. Columnas finales, iguales al CREATE TABLE. NO se renumera id_ruta: vuelo.csv ya usa estos ids
df_final = df[["id_ruta", "id_aeropuerto_origen", "id_aeropuerto_destino", "distancia_km"]].sort_values("id_ruta")

# 8. Exportar
df_final.to_csv(ruta_ruta_csv, index=False)

print(f"Rutas leídas: {n_inicial}")
print(f"Descartadas por aeropuerto inexistente: {n_sin_aeropuerto}")
print(f"Rutas finales: {len(df_final)}")
print(df_final["distancia_km"].describe().round(0).to_string())
print(f"Archivo guardado en {ruta_ruta_csv}")
df_final.head(10)

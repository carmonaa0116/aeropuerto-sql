"""Recalcula distancia_km de data/ruta.csv con la fórmula de Haversine (R = 6371 km) a partir de las
coordenadas de data/aeropuerto.csv. distancia_km = max(1, round(Haversine)).

Uso (desde la raíz del proyecto):   python corregir_distancia_ruta.py
Guarda una copia del CSV anterior en raw_data/ruta_antes_distancias.csv (solo la primera vez).
Orden correcto: este script puede ejecutarse en cualquier momento, no cambia ids ni filas; pero hay que
regenerar reserva/billete (precio = base + tarifa_km x distancia) y recargar con importacion.py --reiniciar.
"""
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

carpeta_data, carpeta_raw = Path("data"), Path("raw_data")
ruta_csv = carpeta_data / "ruta.csv"
copia = carpeta_raw / "ruta_antes_distancias.csv"
if not copia.exists():
    shutil.copy(ruta_csv, copia)

ruta = pd.read_csv(ruta_csv)
aero = pd.read_csv(carpeta_data / "aeropuerto.csv", usecols=["id_aeropuerto", "latitud", "longitud"]).set_index("id_aeropuerto")

lat1 = np.radians(aero.loc[ruta["id_aeropuerto_origen"], "latitud"].to_numpy(float))
lon1 = np.radians(aero.loc[ruta["id_aeropuerto_origen"], "longitud"].to_numpy(float))
lat2 = np.radians(aero.loc[ruta["id_aeropuerto_destino"], "latitud"].to_numpy(float))
lon2 = np.radians(aero.loc[ruta["id_aeropuerto_destino"], "longitud"].to_numpy(float))
a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
km = 2 * 6371.0 * np.arcsin(np.sqrt(a))
antes = int((ruta["distancia_km"] <= 1).sum())
ruta["distancia_km"] = np.maximum(1, np.round(km)).astype(int)
ruta.to_csv(ruta_csv, index=False)
print(f"ruta.csv: {len(ruta)} filas | con distancia <= 1 km: antes {antes}, ahora {int((ruta['distancia_km'] <= 1).sum())} "
      f"| media {ruta['distancia_km'].mean():.0f} km | máxima {ruta['distancia_km'].max()} km")

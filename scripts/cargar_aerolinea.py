"""Actualiza la tabla 'aerolinea' con los campos nuevos de data/aerolinea.csv:
codigo_icao, indicativo y activa.

Uso (desde la raíz del proyecto, donde está la carpeta data/):
    pip install pymysql cryptography
    python scripts/cargar_aerolinea.py --user root                    # pide la contraseña
    python scripts/cargar_aerolinea.py --user root --crear-columnas   # crea las columnas si faltan

Qué hace:
  - NO vacía ni recarga nada: hace UPDATE por clave primaria sobre las filas que ya están en la tabla,
    así no se toca ninguna tabla hija (aeronave, vuelo...) ni hace falta --reiniciar.
  - Lee la cabecera del CSV y empareja por nombre de columna, como importacion.py; el orden da igual.
  - Antes de escribir comprueba que cada id del CSV sigue siendo la misma aerolínea de la BD (id + nombre).
    Si hay descuadres, para: significa que aerolinea.csv se regeneró después de cargar la base.
  - Celdas vacías y 'N/A' -> NULL en codigo_icao e indicativo. 'activa' acepta Y/N, 1/0 y True/False.
  - Todo va en una sola transacción: o se actualiza todo o no se toca nada.
"""
import argparse
import csv
import getpass
import sys
import unicodedata
from pathlib import Path

import pymysql

TABLA = "aerolinea"

# Columnas nuevas y su definición (solo se usa si faltan en la tabla y se pasa --crear-columnas)
NUEVAS = {
    "codigo_icao": "CHAR(3) NULL",
    "indicativo": "VARCHAR(100) NULL",
    "activa": "TINYINT(1) NOT NULL DEFAULT 1",
}
LONGITUD_MAX = {"codigo_icao": 3, "indicativo": 100}
VERDADERO = {"Y", "1", "TRUE", "S", "SI", "SÍ"}
FALSO = {"N", "0", "FALSE", "NO"}


def normalizar(texto):
    """Para comparar nombres: sin espacios sobrantes, Unicode NFC y sin distinguir mayúsculas."""
    return unicodedata.normalize("NFC", (texto or "").strip()).casefold()


def convertir_texto(valor, columna, avisos):
    """codigo_icao / indicativo: vacío o 'N/A' -> NULL; si no cabe en la columna -> NULL y se avisa."""
    v = (valor or "").strip()
    if v == "" or v.upper() == "N/A":
        return None
    if len(v) > LONGITUD_MAX[columna]:
        avisos[columna] = avisos.get(columna, 0) + 1
        return None
    return v


def convertir_activa(valor, avisos):
    """activa: devuelve 1, 0 o None (None = dejar el valor que ya tiene la fila)."""
    v = (valor or "").strip().upper()
    if v in VERDADERO:
        return 1
    if v in FALSO:
        return 0
    if v:
        avisos["activa"] = avisos.get("activa", 0) + 1
    return None


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=3306)
    p.add_argument("--user", default="root")
    p.add_argument("--bd", default="aeropuerto")
    p.add_argument("--carpeta", default="data", help="carpeta con los CSV (por defecto data/)")
    p.add_argument("--crear-columnas", action="store_true",
                   help="si a la tabla le faltan codigo_icao/indicativo/activa, las crea (ALTER TABLE)")
    p.add_argument("--forzar", action="store_true",
                   help="seguir aunque haya descuadres de id/nombre (no recomendado)")
    args = p.parse_args()

    ruta = Path(args.carpeta) / "aerolinea.csv"
    if not ruta.exists():
        sys.exit(f"No existe '{ruta}'. Ejecuta el script desde la raíz del proyecto.")
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        lector = csv.DictReader(f)
        cabecera = lector.fieldnames or []
        filas = list(lector)

    password = getpass.getpass(f"Contraseña de MySQL para {args.user}: ")
    conn = pymysql.connect(host=args.host, port=args.port, user=args.user, password=password,
                           database=args.bd, charset="utf8mb4", autocommit=False)
    cur = conn.cursor()

    # 1) Estructura real de la tabla y su clave primaria
    cur.execute("SELECT COLUMN_NAME, COLUMN_KEY FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s", (args.bd, TABLA))
    columnas = {nombre: clave for nombre, clave in cur.fetchall()}
    if not columnas:
        sys.exit(f"No existe la tabla '{TABLA}' en la base '{args.bd}'.")
    claves = [n for n, k in columnas.items() if k == "PRI"]
    if len(claves) != 1:
        sys.exit(f"Esperaba una clave primaria simple en '{TABLA}' y hay: {claves or 'ninguna'}.")
    pk = claves[0]
    if pk not in cabecera:
        sys.exit(f"La cabecera de {ruta.name} no tiene la clave primaria '{pk}'. Cabecera: {', '.join(cabecera)}")

    # 2) Columnas nuevas: deben existir en la tabla
    faltan = [c for c in NUEVAS if c not in columnas]
    if faltan:
        alter = f"ALTER TABLE `{TABLA}` " + ", ".join(f"ADD COLUMN `{c}` {NUEVAS[c]}" for c in faltan)
        if "codigo_icao" in faltan:
            alter += ", ADD INDEX `idx_aerolinea_icao` (`codigo_icao`)"
        if not args.crear_columnas:
            sys.exit(f"A la tabla '{TABLA}' le faltan columnas: {', '.join(faltan)}.\n"
                     f"Ejecuta esto en MySQL o relanza con --crear-columnas:\n  {alter};")
        cur.execute(alter)
        conn.commit()
        print(f"Columnas creadas: {', '.join(faltan)}")
        columnas.update({c: "" for c in faltan})

    # 3) Columnas nuevas que trae el CSV
    usar = [c for c in NUEVAS if c in cabecera]
    if not usar:
        sys.exit(f"{ruta.name} no trae ninguna de {', '.join(NUEVAS)}. Cabecera: {', '.join(cabecera)}")
    ausentes = [c for c in NUEVAS if c not in cabecera]
    if ausentes:
        print(f"Aviso: el CSV no trae {', '.join(ausentes)}; esas columnas no se tocan.")

    # 4) Comprobar que los ids del CSV siguen apuntando a la misma aerolínea que la BD
    cur.execute(f"SELECT `{pk}`, `nombre` FROM `{TABLA}`")
    en_bd = {str(i): n for i, n in cur.fetchall()}
    parametros, no_encontradas, distinto_nombre, avisos = [], [], [], {}
    ids_csv = set()
    for fila in filas:
        id_ = (fila.get(pk) or "").strip()
        ids_csv.add(id_)
        if id_ not in en_bd:
            no_encontradas.append(id_)
            continue
        if "nombre" in fila and normalizar(fila["nombre"]) != normalizar(en_bd[id_]):
            distinto_nombre.append((id_, fila["nombre"], en_bd[id_]))
        valores = []
        for col in usar:
            if col == "activa":
                valores.append(convertir_activa(fila.get(col), avisos))
            else:
                valores.append(convertir_texto(fila.get(col), col, avisos))
        parametros.append((*valores, id_))

    descuadres = len(no_encontradas) + len(distinto_nombre)
    sin_csv = len(set(en_bd) - ids_csv)
    print(f"CSV: {len(filas)} filas | BD: {len(en_bd)} filas | ids del CSV que no están en la BD: "
          f"{len(no_encontradas)} | ids con nombre distinto: {len(distinto_nombre)} | filas de la BD sin CSV: {sin_csv}")
    if descuadres and not args.forzar:
        for id_, nom_csv, nom_bd in distinto_nombre[:5]:
            print(f"   id {id_}: CSV '{nom_csv}'  !=  BD '{nom_bd}'")
        if no_encontradas:
            print(f"   ids ausentes en la BD (primeros 5): {no_encontradas[:5]}")
        sys.exit("\nLos ids del CSV no coinciden con la BD: probablemente aerolinea.csv se regeneró después de "
                 "cargarla. No he tocado nada. Si aun así quieres seguir, usa --forzar; lo correcto es "
                 "recargar con importacion.py --reiniciar.")

    # 5) UPDATE en una sola transacción
    sets = ", ".join("`activa` = COALESCE(%s, `activa`)" if c == "activa" else f"`{c}` = %s" for c in usar)
    sql = f"UPDATE `{TABLA}` SET {sets} WHERE `{pk}` = %s"
    try:
        cur.executemany(sql, parametros)
        conn.commit()
    except pymysql.MySQLError as e:
        conn.rollback()
        sys.exit(f"[XX] {e}\nSe ha deshecho todo; la tabla no ha cambiado.")
    print(f"[OK] {len(parametros)} aerolíneas procesadas")
    for col, n in avisos.items():
        print(f"     {n} valores de '{col}' no válidos (demasiado largos o no reconocidos): se han dejado a NULL / sin cambio")

    # 6) Resumen
    cur.execute(f"SELECT COUNT(*), SUM(`codigo_icao` IS NOT NULL), SUM(`indicativo` IS NOT NULL), SUM(`activa`) "
                f"FROM `{TABLA}`")
    total, con_icao, con_indicativo, activas = cur.fetchone()
    print(f"Estado final: {total} filas | con ICAO: {con_icao} | con indicativo: {con_indicativo} | activas: {activas}")
    cur.execute(f"SELECT COUNT(*) FROM (SELECT `codigo_icao` FROM `{TABLA}` WHERE `codigo_icao` IS NOT NULL "
                f"GROUP BY `codigo_icao` HAVING COUNT(*) > 1) t")
    duplicados = cur.fetchone()[0]
    if duplicados:
        print(f"Info: {duplicados} códigos ICAO aparecen en más de una aerolínea (OpenFlights los repite; "
              f"por eso el índice no es UNIQUE).")
    conn.close()


if __name__ == "__main__":
    main()
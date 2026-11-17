"""Carga en lote todos los CSV de data/ en la base MySQL 'aeropuerto'.

Uso (desde la raíz del proyecto, donde está la carpeta data/):
    pip install pymysql cryptography
    python cargar_mysql.py --user root                 # pide la contraseña
    python cargar_mysql.py --user root --reiniciar     # vacía las tablas (TRUNCATE) antes de cargar

Qué hace:
  - Recorre las 21 tablas en el orden de las claves foráneas y salta las que no tengan CSV todavía.
  - Usa LOAD DATA LOCAL INFILE (mucho más rápido que INSERT o pandas.to_sql).
  - Lee la cabecera de cada CSV y la empareja con las columnas reales de la tabla, así no depende
    del orden de las columnas. Las columnas del CSV que no existen en la tabla se ignoran y se avisa
    (p. ej. codigo_icao, indicativo y activa de aerolinea.csv si no has ampliado esa tabla).
  - Las celdas vacías se cargan como NULL (puerta/pista de vuelo, asiento, fecha_fin, email...).
  - Los CSV sin columna id (modelo_aeronave, clase_cabina) reciben ids 1..N por AUTO_INCREMENT,
    igual que asumen los scripts generadores.
"""
import argparse
import csv
import getpass
import sys
from pathlib import Path

import pymysql

# Orden de carga por claves foráneas
ORDEN = [
    "pais", "aeropuerto", "aerolinea", "modelo_aeronave", "clase_cabina", "aeronave",
    "terminal", "pista", "ruta", "puerta_embarque", "vuelo", "evento_vuelo",
    "empleado", "tripulacion_vuelo", "pasajero", "reserva", "billete",
    "tarjeta_embarque", "equipaje", "mantenimiento", "incidencia",
]

# ruta.csv: los generadores buscan las columnas por palabra clave ("orig", "dest", "dist"); aquí igual
ALIAS_RUTA = (("orig", "id_aeropuerto_origen"), ("dest", "id_aeropuerto_destino"), ("dist", "distancia_km"))


def resolver_columna(tabla, col, columnas_tabla):
    """Nombre de la columna de la tabla que corresponde a la columna del CSV (None = ignorar)."""
    if col in columnas_tabla:
        return col
    if tabla == "ruta":
        for clave, destino in ALIAS_RUTA:
            if clave in col.lower() and destino in columnas_tabla:
                return destino
    return None


def detectar_fin_de_linea(ruta):
    """pandas escribe \\r\\n en Windows y \\n en Linux/Mac. Devuelve el literal tal como va en el SQL."""
    with open(ruta, "rb") as f:
        muestra = f.read(4096)
    return r"\r\n" if b"\r\n" in muestra else r"\n"


def construir_sql(tabla, ruta_csv, cabecera, columnas_tabla, fin_linea):
    variables, sets, omitidas = [], [], []
    for col in cabecera:
        destino = resolver_columna(tabla, col, columnas_tabla)
        if destino is None:
            variables.append("@_omitida")
            omitidas.append(col)
        else:
            variables.append(f"@c_{destino}")
            sets.append(f"`{destino}` = NULLIF(@c_{destino}, '')")  # celda vacía -> NULL
    ruta_sql = ruta_csv.resolve().as_posix().replace("'", "''")
    sql = (
        f"LOAD DATA LOCAL INFILE '{ruta_sql}' INTO TABLE `{tabla}`\n"
        f"CHARACTER SET utf8mb4\n"
        f"FIELDS TERMINATED BY ',' OPTIONALLY ENCLOSED BY '\"' ESCAPED BY ''\n"  # ESCAPED BY '': la barra \ es texto normal
        f"LINES TERMINATED BY '{fin_linea}'\n"
        f"IGNORE 1 LINES\n"
        f"({', '.join(variables)})\n"
        f"SET {', '.join(sets)}"
    )
    return sql, omitidas


def contar_filas(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as f:
        return sum(1 for _ in csv.reader(f)) - 1


def conectar(args, password):
    return pymysql.connect(
        host=args.host, port=args.port, user=args.user, password=password,
        database=args.bd, charset="utf8mb4", local_infile=True, autocommit=True,
    )


def local_infile_activo(cur):
    cur.execute("SHOW GLOBAL VARIABLES LIKE 'local_infile'")
    fila = cur.fetchone()
    return bool(fila) and str(fila[1]).upper() in ("ON", "1")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=3306)
    p.add_argument("--user", default="root")
    p.add_argument("--bd", default="aeropuerto")
    p.add_argument("--carpeta", default="data", help="carpeta con los CSV (por defecto data/)")
    p.add_argument("--reiniciar", action="store_true", help="TRUNCATE de todas las tablas antes de cargar")
    p.add_argument("--continuar", action="store_true", help="no parar cuando una tabla pierda filas")
    p.add_argument("--si", action="store_true", help="con --reiniciar, no pedir confirmación")
    args = p.parse_args()

    carpeta = Path(args.carpeta)
    if not carpeta.is_dir():
        sys.exit(f"No existe la carpeta '{carpeta}'. Ejecuta el script desde la raíz del proyecto.")
    password = getpass.getpass(f"Contraseña de MySQL para {args.user}: ")

    conn = conectar(args, password)
    cur = conn.cursor()
    if not local_infile_activo(cur):
        # La capacidad se negocia al conectar: hay que activar la variable y reconectar
        try:
            cur.execute("SET GLOBAL local_infile = 1")
            conn.close()
            conn = conectar(args, password)
            cur = conn.cursor()
        except pymysql.MySQLError:
            pass
        if not local_infile_activo(cur):
            sys.exit("El servidor tiene local_infile desactivado y este usuario no puede activarlo.\n"
                     "Ejecuta como administrador:  SET GLOBAL local_infile = 1;  y vuelve a lanzar el script.")

    if args.reiniciar:
        con_datos = {}
        for tabla in ORDEN:
            cur.execute(f"SELECT COUNT(*) FROM `{tabla}`")
            n = cur.fetchone()[0]
            if n:
                con_datos[tabla] = n
        if con_datos:
            print("Se van a BORRAR los datos actuales de:")
            for tabla, n in con_datos.items():
                print(f"   {tabla}: {n} filas")
            if not args.si and input("¿Vaciar estas tablas y recargar desde los CSV? (s/N): ").strip().lower() != "s":
                sys.exit("Cancelado, no se ha tocado nada.")
        cur.execute("SET FOREIGN_KEY_CHECKS = 0")
        for tabla in reversed(ORDEN):
            try:
                cur.execute(f"TRUNCATE TABLE `{tabla}`")  # rápido y reinicia AUTO_INCREMENT
            except pymysql.MySQLError:
                cur.execute(f"DELETE FROM `{tabla}`")     # plan B si MySQL no deja truncar una tabla referenciada
                cur.execute(f"ALTER TABLE `{tabla}` AUTO_INCREMENT = 1")
        cur.execute("SET FOREIGN_KEY_CHECKS = 1")
        for tabla in ORDEN:  # comprobación: no debe quedar nada
            cur.execute(f"SELECT COUNT(*) FROM `{tabla}`")
            if cur.fetchone()[0]:
                sys.exit(f"No se ha podido vaciar '{tabla}'. Paro antes de cargar para no mezclar datos viejos y nuevos.")
        print("Tablas vaciadas y verificadas.\n")

    resumen = []
    for tabla in ORDEN:
        ruta = carpeta / f"{tabla}.csv"
        if not ruta.exists():
            print(f"[--] {tabla}: sin CSV, se omite")
            resumen.append((tabla, "sin CSV", "", ""))
            continue

        cur.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s",
                    (args.bd, tabla))
        columnas_tabla = {r[0] for r in cur.fetchall()}
        with open(ruta, encoding="utf-8-sig", newline="") as f:
            cabecera = next(csv.reader(f))
        sql, omitidas = construir_sql(tabla, ruta, cabecera, columnas_tabla, detectar_fin_de_linea(ruta))

        try:
            cargadas = cur.execute(sql)
            cur.execute("SHOW WARNINGS")
            avisos = cur.fetchall()
        except pymysql.MySQLError as e:
            sys.exit(f"[XX] {tabla}: {e}\n"
                     f"     Si es 'Duplicate entry', la tabla ya tenía datos: usa --reiniciar.")

        esperadas = contar_filas(ruta)
        perdidas = esperadas - cargadas
        marca = "OK" if not perdidas and not avisos else "!!"
        print(f"[{marca}] {tabla}: {cargadas} filas cargadas de {esperadas} en el CSV")
        if omitidas:
            print(f"     columnas del CSV ignoradas (no existen en la tabla): {', '.join(omitidas)}")
        por_codigo = {}  # LOAD DATA LOCAL equivale a IGNORE: los errores se saltan la fila y quedan como avisos
        for _, codigo, mensaje in avisos:
            por_codigo.setdefault(codigo, [0, mensaje])[0] += 1
        for codigo, (n, mensaje) in por_codigo.items():
            print(f"     {n} avisos {codigo} (MySQL guarda como máximo 1024): {mensaje}")
        resumen.append((tabla, cargadas, esperadas, len(avisos)))
        if perdidas and not args.continuar:
            sys.exit(f"\nSe han perdido {perdidas} filas en '{tabla}'. Paro aquí para no arrastrar el fallo a las tablas "
                     f"dependientes. Corrige el CSV y relanza con --reiniciar (o usa --continuar para seguir igualmente).")

    conn.close()
    problemas = [r for r in resumen if r[1] != "sin CSV" and (r[1] != r[2] or r[3])]
    print("\nCarga terminada." + (f" Revisa {len(problemas)} tabla(s) con avisos o filas perdidas." if problemas else " Sin incidencias."))


if __name__ == "__main__":
    main()
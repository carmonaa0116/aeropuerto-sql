# Aeropuerto: base de datos MySQL 8 con datos reales de aviación

Proyecto de SQL avanzado: una base de datos de **21 tablas** que modela un
aeropuerto (vuelos, aeronaves, tripulación, pasajeros, reservas, billetes,
equipaje, mantenimiento e incidencias), poblada con datos reales de
aviación (**355.006 vuelos**) y con integridad reforzada con triggers.

## Qué demuestra

- **Modelado**: 21 tablas, 27 claves foráneas, 10 restricciones `CHECK`.
- **Integridad avanzada con triggers y procedimientos**: sin solape de
  puerta, pista ni aeronave; sin overbooking ni asientos duplicados; descanso
  mínimo de tripulación. 24 casos de prueba automáticos (`sql/99_tests_triggers.sql`).
- **SQL analítico**: CTE (incluidas recursivas), funciones ventana (`RANK`,
  `NTILE`, `LAG`, medias móviles), `ROLLUP`, subconsultas correlacionadas y
  `NOT EXISTS` (`sql/04_consultas_avanzadas.sql`).
- **Rendimiento**: índices justificados con medición antes/después
  (`docs/rendimiento.md`).
- **Calidad de datos**: ~110 comprobaciones automáticas
  (`sql/verificar_aeropuerto.sql`); la última ejecución dio 0 fallos.
- **ETL en Python**: scripts reproducibles que transforman las fuentes a
  CSV con las columnas exactas de cada tabla y los cargan en lote.

## Datos

| Tabla(s) | Origen |
|---|---|
| pais, aeropuerto, aerolinea, ruta | [OpenFlights](https://openflights.org/data) (distancias recalculadas con Haversine) |
| pista | [OurAirports](https://ourairports.com/data/) |
| puerta_embarque | OpenStreetMap (Overpass) + puertas sintéticas sin solapes |
| aeronave | OpenSky Aircraft Database (2025-08) |
| **vuelo** | **BTS On-Time Performance (EE. UU., enero 2026)**: horarios previstos y reales, retrasos y cancelaciones |
| evento_vuelo | Derivado de vuelo (salida y llegada reales; check-in, embarque y cierre por reglas) |
| empleado, tripulacion_vuelo, pasajero, reserva, billete, tarjeta_embarque, equipaje, mantenimiento, incidencia | Sintéticos calibrados (Faker `es_ES` + reglas de negocio) |

Cifras cargadas: 355.006 vuelos, 1,79 M eventos, 100.000 pasajeros,
678.760 billetes, 24.063 aeronaves, 5.906 aeropuertos.

## Estructura

```
sql/        DDL, triggers, tests, verificación, consultas e índices
scripts/    ETL en Python (se ejecutan desde la raíz del proyecto)
docs/       modelo de Workbench y análisis de rendimiento
limpieza.ipynb   generación de catálogos y datos sintéticos
data/, raw_data/ (no se suben a GitHub; ver "Reproducir")
```

| Archivo | Para qué |
|---|---|
| `sql/creacion.sql` | Crea la base de datos y las 21 tablas |
| `sql/01_triggers_vuelo.sql`, `02_triggers_ventas.sql`, `03_triggers_tripulacion.sql` | Reglas de negocio |
| `sql/99_tests_triggers.sql` | `CALL sp_test_triggers()` → 24/24 casos OK |
| `sql/04_consultas_avanzadas.sql` | 10 consultas con pregunta de negocio |
| `sql/05_indices.sql` | Índices con `EXPLAIN ANALYZE` |
| `sql/verificar_aeropuerto.sql` | Comprobaciones de calidad |

## Consultas destacadas

| # | Pregunta | Técnicas |
|---|---|---|
| Q01 | ¿Qué aerolíneas son más puntuales? | CTE, `RANK`, `AVG OVER ()` |
| Q03 | ¿Qué parte de los retrasos viene de un avión que llegó tarde antes? (≈ 50 % de los vuelos con retraso de salida) | `LAG` por aeronave |
| Q04 | Tendencia de puntualidad con media móvil de 7 días | CTE recursiva (calendario), ventana de filas |
| Q05 | Rachas de días seguidos con retraso alto por aeropuerto | gaps and islands |
| Q06 | Mejor itinerario con una escala desde un aeropuerto | CTE recursiva sobre vuelos |
| Q08 | Ingresos por aerolínea y clase con subtotales | `WITH ROLLUP` |

## Reproducir

Requisitos: MySQL 8, Python 3 (pandas, Faker, mysql-connector), MySQL
Workbench o cliente `mysql` con `local_infile` activado.

1. Descarga las fuentes a `raw_data/`: OpenFlights (`airports.dat`,
   `airlines.dat`, `routes.dat`, `countries.dat`), OurAirports
   (`runways.csv`), OpenSky Aircraft Database y el BTS On-Time
   Performance (transtats.bts.gov, un mes).
2. Crea el esquema: `sql/creacion.sql`.
3. Genera los CSV (desde la raíz del proyecto): catálogos en
   `limpieza.ipynb` y después
   `python scripts/generar_vuelo.py`,
   `python scripts/generar_puertas_sinteticas.py`,
   `python scripts/corregir_distancia_ruta.py`; resto de tablas sintéticas
   en las celdas correspondientes del notebook.
4. Carga: `python scripts/importacion.py --user root --reiniciar`
   (si ya había triggers, ejecuta antes `sql/00_quitar_triggers.sql`).
5. Verifica con `sql/verificar_aeropuerto.sql` e instala los triggers con
   `sql/01`, `02` y `03`.

## Limitaciones conocidas

- Solo sobrevive el 65 % de las filas del BTS tras cruzar con aeronaves
  (OpenSky) y aerolíneas; hay vuelos de 8 aerolíneas de EE. UU.
- Puerta y pista de cada vuelo son sintéticas (no existen en la fuente).
- Billetes y pasajeros son sintéticos y solo hay billetes para una muestra
  de 5.000 vuelos.
- ~820 pares de vuelos de la misma aeronave tienen horas reales solapadas
  (ruido de los datos reales: cambios de avión, retrasos). Los triggers
  validan datos nuevos, no los históricos.
- Las horas están en UTC.

## Autor

Alejandro Carmona · [LinkedIn](https://www.linkedin.com/in/alejandro-carmona-rodero-03b204321) · [GitHub](https://github.com/carmonaa0116)

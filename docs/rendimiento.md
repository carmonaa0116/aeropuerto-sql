# Rendimiento: índices y EXPLAIN ANALYZE

Objetivo: justificar cada índice extra con una medición antes/después sobre
los datos reales del proyecto (355.006 vuelos, 678.760 billetes, 100.000
pasajeros). Script: `sql/05_indices.sql`. Consultas: `sql/04_consultas_avanzadas.sql`.

## Metodología

- Se midió el tiempo total de cada consulta (mejor de 3 ejecuciones, caché
  caliente) y se revisó el plan de ejecución con `ANALYZE` (filas reales
  leídas por tabla y método de acceso).
- **Entorno de esta medición:** MariaDB 10.11 con los mismos CSV, 2 CPU,
  buffer pool de 2 GB. Los tiempos absolutos en tu MySQL 8 serán distintos;
  lo que se compara es antes frente a después. Para el informe final, repite
  el bloque `EXPLAIN ANALYZE` de `sql/05_indices.sql` en MySQL 8 y sustituye
  la columna de tiempo.

## Qué ya estaba indexado (y por qué no hizo falta tocarlo)

| Consulta | Acceso clave | Índice existente |
|---|---|---|
| Q03 (retrasos en cascada) | `PARTITION BY id_aeronave ORDER BY salida_prevista` | `idx_vuelo_aeronave_salida` |
| Q06 (conexiones, recursiva) | rutas por aeropuerto de origen | `uq_ruta (origen, destino)` |
| Q07 (utilización vs mantenimiento) | mantenimiento por aeronave | índice de la FK `id_aeronave` |

## Índices añadidos

### I1 — `billete (id_vuelo, estado)` — consulta Q09

Q09 cuenta, para cada vuelo de la muestra, los billetes no cancelados
(subconsulta correlacionada).

| | Antes | Después |
|---|---|---|
| Índice usado en la subconsulta | `uq_billete_pasajero_vuelo (id_vuelo, id_pasajero)` | `idx_billete_vuelo_estado` |
| Extra del plan | `Using where` (lee la fila para comprobar `estado`) | `Using index` (covering) |
| Tiempo | 2,33 s | **1,14 s** (−51 %) |

El índice antiguo permitía localizar los billetes del vuelo, pero obligaba a
leer cada fila para mirar `estado`. Con `estado` en el índice, no se toca la
tabla.

### I2 — `billete (id_pasajero, estado, id_vuelo, precio)` — consulta Q10

Q10 busca pasajeros con ≥ 3 vuelos y ningún billete cancelado
(`NOT EXISTS`) y suma su gasto.

| | Antes | Después |
|---|---|---|
| Acceso a `billete` (consulta principal) | `ref` por FK `id_pasajero`, lee filas | `ref`, `Using index` (covering) |
| Acceso a `billete` (`NOT EXISTS`) | `ALL`, 678.760 filas leídas | `index` (recorrido del índice, sin leer filas) |
| Tiempo | 0,78 s | **0,45 s** (−42 %) |

El índice incluye `id_vuelo` y `precio` (las columnas que usa el
`COUNT(DISTINCT ...)` y el `SUM`), de modo que ninguna parte lee la tabla.
Al empezar por `id_pasajero`, sustituye al índice implícito de la FK.

## Índices probados y descartados

| Índice | Consulta objetivo | Resultado |
|---|---|---|
| `vuelo (id_ruta, salida_prevista, estado)` | Q06 | 7,8 s → 7,9 s. Sin mejora: el coste está en generar los itinerarios de la recursión, no en localizar los vuelos de una ruta |
| `vuelo (estado, id_aeronave)` | Q01, Q07 | 0,79 → 0,70 s y 1,21 → 1,10 s: dentro del ruido y con coste de escritura en una tabla de 355.000 filas con triggers |

Con la CTE recursiva sin límite de profundidad (hasta 2 escalas), Q06 tardó
~1,5 min y con ese mismo índice empeoró (~5 min) porque el optimizador de
MariaDB eligió un plan peor: es una muestra de que un índice extra no es
gratis. Por eso Q06 se limitó a una escala.

## Coste de los índices

`billete` es la tabla con más escrituras (triggers de overbooking y
asientos). Los dos índices nuevos añaden mantenimiento en cada INSERT y
UPDATE de `estado`; con una carga masiva se recomienda crearlos después de
`LOAD DATA`, que es lo que hace el flujo del proyecto.

## Limitaciones

- Datos de billetes sintéticos y solo para 5.000 vuelos: las ganancias de I1
  e I2 dependen de ese volumen.
- Mediciones en MariaDB 10.11; pendiente de repetir con `EXPLAIN ANALYZE` en
  MySQL 8 (sintaxis distinta: MariaDB usa `ANALYZE`).

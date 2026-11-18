-- Copia literal de sql/04_consultas_avanzadas.sql (Q06).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH RECURSIVE itinerario AS (
    SELECT v.id_vuelo                          AS ultimo_vuelo,
           r.id_aeropuerto_destino             AS aeropuerto_actual,
           v.salida_prevista                   AS salida_inicial,
           v.llegada_prevista                  AS llegada_actual,
           1                                   AS tramos,
           CAST(v.numero_vuelo AS CHAR(100))   AS vuelos,
           CAST(CONCAT(',', r.id_aeropuerto_origen, ',', r.id_aeropuerto_destino, ',') AS CHAR(100)) AS visitados
    FROM vuelo v
    JOIN ruta r        ON r.id_ruta = v.id_ruta
    JOIN aeropuerto ao ON ao.id_aeropuerto = r.id_aeropuerto_origen
    WHERE ao.codigo_iata = ?
      AND v.estado <> 'cancelado'
      AND v.salida_prevista >= ?
      AND v.salida_prevista <  ?
    UNION ALL
    SELECT v2.id_vuelo, r2.id_aeropuerto_destino, i.salida_inicial, v2.llegada_prevista, i.tramos + 1,
           CONCAT(i.vuelos, ' > ', v2.numero_vuelo),
           CONCAT(i.visitados, r2.id_aeropuerto_destino, ',')
    FROM itinerario i
    JOIN ruta r2  ON r2.id_aeropuerto_origen = i.aeropuerto_actual
    JOIN vuelo v2 ON v2.id_ruta = r2.id_ruta
    WHERE i.tramos < 2
      AND v2.estado <> 'cancelado'
      AND v2.salida_prevista >= i.llegada_actual + INTERVAL 60 MINUTE
      AND v2.salida_prevista <= i.llegada_actual + INTERVAL 4 HOUR
      AND i.visitados NOT LIKE CONCAT('%,', r2.id_aeropuerto_destino, ',%')
),
mejor AS (
    SELECT i.*, TIMESTAMPDIFF(MINUTE, salida_inicial, llegada_actual) AS duracion_min,
           ROW_NUMBER() OVER (PARTITION BY aeropuerto_actual ORDER BY llegada_actual, tramos) AS n
    FROM itinerario i
)
SELECT ap.codigo_iata AS destino, m.tramos, m.vuelos, m.duracion_min
FROM mejor m JOIN aeropuerto ap ON ap.id_aeropuerto = m.aeropuerto_actual
WHERE m.n = 1
ORDER BY m.tramos DESC, m.duracion_min
LIMIT 25

-- Copia literal de sql/04_consultas_avanzadas.sql (Q03).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH cadena AS (
    SELECT v.id_vuelo,
           v.id_aeronave,
           r.id_aeropuerto_origen,
           v.estado,
           TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.salida_real)      AS retraso_salida,
           LAG(r.id_aeropuerto_destino) OVER w                          AS destino_anterior,
           LAG(TIMESTAMPDIFF(MINUTE, v.llegada_prevista, v.llegada_real)) OVER w AS retraso_llegada_anterior,
           TIMESTAMPDIFF(MINUTE, LAG(v.llegada_real) OVER w, v.salida_prevista)  AS margen_rotacion_min
    FROM vuelo v
    JOIN ruta r ON r.id_ruta = v.id_ruta
    WHERE v.estado <> 'cancelado'
    WINDOW w AS (PARTITION BY v.id_aeronave ORDER BY v.salida_prevista)
)
SELECT COUNT(*)                                                   AS vuelos_con_retraso_salida,
       SUM(destino_anterior = id_aeropuerto_origen
           AND retraso_llegada_anterior >= 15)                    AS tras_llegada_tardia_mismo_avion,
       ROUND(100 * SUM(destino_anterior = id_aeropuerto_origen
                       AND retraso_llegada_anterior >= 15) / COUNT(*), 1) AS pct_cascada,
       ROUND(AVG(CASE WHEN destino_anterior = id_aeropuerto_origen
                      THEN margen_rotacion_min END), 0)           AS margen_medio_rotacion_min
FROM cadena
WHERE retraso_salida >= 15

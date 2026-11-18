-- Copia literal de sql/04_consultas_avanzadas.sql (Q05).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH dia_aeropuerto AS (
    SELECT r.id_aeropuerto_origen                                      AS id_aeropuerto,
           DATE(v.salida_prevista)                                     AS dia,
           COUNT(*)                                                    AS salidas,
           AVG(TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.salida_real)) AS retraso_medio
    FROM vuelo v
    JOIN ruta r ON r.id_ruta = v.id_ruta
    WHERE v.estado <> 'cancelado'
      AND DATE(v.salida_prevista) BETWEEN ? AND ?
    GROUP BY r.id_aeropuerto_origen, DATE(v.salida_prevista)
    HAVING COUNT(*) >= ?
),
malos AS (
    SELECT id_aeropuerto, dia, retraso_medio,
           DATE_SUB(dia, INTERVAL ROW_NUMBER() OVER (PARTITION BY id_aeropuerto ORDER BY dia) DAY) AS isla
    FROM dia_aeropuerto
    WHERE retraso_medio > ?
),
rachas AS (
    SELECT id_aeropuerto,
           MIN(dia)                    AS inicio,
           MAX(dia)                    AS fin,
           COUNT(*)                    AS dias_seguidos,
           ROUND(AVG(retraso_medio),1) AS retraso_medio_racha
    FROM malos
    GROUP BY id_aeropuerto, isla
)
SELECT ap.codigo_iata, ap.nombre, r.inicio, r.fin, r.dias_seguidos, r.retraso_medio_racha
FROM rachas r
JOIN aeropuerto ap ON ap.id_aeropuerto = r.id_aeropuerto
ORDER BY r.dias_seguidos DESC, r.retraso_medio_racha DESC
LIMIT ?

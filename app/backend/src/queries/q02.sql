-- Copia literal de sql/04_consultas_avanzadas.sql (Q02).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH salidas AS (
    SELECT r.id_aeropuerto_origen                              AS id_aeropuerto,
           COUNT(*)                                            AS salidas,
           AVG(TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.salida_real)) AS retraso_medio_min
    FROM vuelo v
    JOIN ruta r ON r.id_ruta = v.id_ruta
    WHERE v.estado <> 'cancelado'
    GROUP BY r.id_aeropuerto_origen
    HAVING COUNT(*) >= ?
),
cuartiles AS (
    SELECT s.*, NTILE(4) OVER (ORDER BY retraso_medio_min DESC) AS cuartil
    FROM salidas s
)
SELECT c.cuartil,
       ap.codigo_iata,
       ap.nombre,
       c.salidas,
       ROUND(c.retraso_medio_min, 1) AS retraso_medio_min
FROM cuartiles c
JOIN aeropuerto ap ON ap.id_aeropuerto = c.id_aeropuerto
ORDER BY c.cuartil, c.retraso_medio_min DESC

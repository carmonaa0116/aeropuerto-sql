-- Copia literal de sql/04_consultas_avanzadas.sql (Q04).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH RECURSIVE calendario AS (
    SELECT DATE(?) AS dia
    UNION ALL
    SELECT dia + INTERVAL 1 DAY FROM calendario WHERE dia < ?
),
diario AS (
    SELECT DATE(salida_prevista)                          AS dia,
           COUNT(*)                                       AS vuelos,
           100 * SUM(estado = 'retrasado') / COUNT(*)     AS pct_retraso
    FROM vuelo
    WHERE estado <> 'cancelado'
    GROUP BY DATE(salida_prevista)
)
SELECT c.dia,
       COALESCE(d.vuelos, 0)                                              AS vuelos,
       ROUND(d.pct_retraso, 1)                                            AS pct_retraso,
       ROUND(AVG(d.pct_retraso) OVER (ORDER BY c.dia
                                      ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1) AS media_movil_7d
FROM calendario c
LEFT JOIN diario d ON d.dia = c.dia
ORDER BY c.dia

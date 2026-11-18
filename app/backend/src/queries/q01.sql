-- Copia literal de sql/04_consultas_avanzadas.sql (Q01).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH por_aerolinea AS (
    SELECT al.id_aerolinea,
           al.nombre,
           COUNT(*)                                           AS vuelos,
           SUM(v.estado = 'retrasado')                        AS retrasados,
           ROUND(100 * SUM(v.estado = 'retrasado') / COUNT(*), 2) AS pct_retraso
    FROM vuelo v
    JOIN aeronave  a  ON a.id_aeronave  = v.id_aeronave
    JOIN aerolinea al ON al.id_aerolinea = a.id_aerolinea
    WHERE v.estado <> 'cancelado'
    GROUP BY al.id_aerolinea, al.nombre
)
SELECT RANK() OVER (ORDER BY pct_retraso)                      AS puesto,
       nombre,
       vuelos,
       pct_retraso,
       ROUND(pct_retraso - AVG(pct_retraso) OVER (), 2)        AS dif_vs_media_aerolineas
FROM por_aerolinea
ORDER BY puesto

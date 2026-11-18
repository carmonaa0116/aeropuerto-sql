-- Copia literal de sql/04_consultas_avanzadas.sql (Q07).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH horas AS (
    SELECT id_aeronave,
           COUNT(*)                                                        AS vuelos,
           ROUND(SUM(TIMESTAMPDIFF(MINUTE, salida_real, llegada_real)) / 60, 1) AS horas_voladas
    FROM vuelo
    WHERE estado <> 'cancelado' AND salida_real IS NOT NULL AND llegada_real IS NOT NULL
    GROUP BY id_aeronave
),
mant AS (
    SELECT id_aeronave,
           COUNT(*)  AS intervenciones,
           SUM(coste) AS coste_total
    FROM mantenimiento
    GROUP BY id_aeronave
)
SELECT a.matricula,
       al.codigo_iata                                            AS aerolinea,
       m.nombre                                                  AS modelo,
       h.vuelos,
       h.horas_voladas,
       COALESCE(mt.intervenciones, 0)                            AS intervenciones,
       COALESCE(mt.coste_total, 0)                               AS coste_mantenimiento,
       ROUND(COALESCE(mt.coste_total, 0) / NULLIF(h.horas_voladas, 0), 2) AS coste_por_hora,
       ROUND(h.horas_voladas - (SELECT AVG(horas_voladas) FROM horas), 1) AS horas_vs_media_flota
FROM horas h
JOIN aeronave a         ON a.id_aeronave = h.id_aeronave
JOIN modelo_aeronave m  ON m.id_modelo   = a.id_modelo
JOIN aerolinea al       ON al.id_aerolinea = a.id_aerolinea
LEFT JOIN mant mt       ON mt.id_aeronave = h.id_aeronave
ORDER BY h.horas_voladas DESC
LIMIT ?

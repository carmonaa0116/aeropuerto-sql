-- Copia literal de sql/04_consultas_avanzadas.sql (Q08).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
SELECT COALESCE(al.nombre, 'TOTAL')              AS aerolinea,
       COALESCE(c.nombre, 'todas las clases')    AS clase,
       COUNT(*)                         AS billetes,
       ROUND(SUM(b.precio), 2)          AS ingresos,
       ROUND(AVG(b.precio), 2)          AS precio_medio
FROM billete b
JOIN vuelo v         ON v.id_vuelo = b.id_vuelo
JOIN aeronave a      ON a.id_aeronave = v.id_aeronave
JOIN aerolinea al    ON al.id_aerolinea = a.id_aerolinea
JOIN clase_cabina c  ON c.id_clase = b.id_clase
WHERE b.estado <> 'cancelado'
GROUP BY al.nombre, c.nombre WITH ROLLUP

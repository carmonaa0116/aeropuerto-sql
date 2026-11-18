-- Copia literal de sql/04_consultas_avanzadas.sql (Q09).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
WITH ocupacion AS (
    SELECT v.id_vuelo,
           v.numero_vuelo,
           v.id_ruta,
           m.capacidad_total,
           (SELECT COUNT(*) FROM billete b
             WHERE b.id_vuelo = v.id_vuelo AND b.estado <> 'cancelado')   AS pasajeros
    FROM vuelo v
    JOIN aeronave a        ON a.id_aeronave = v.id_aeronave
    JOIN modelo_aeronave m ON m.id_modelo = a.id_modelo
    WHERE v.id_vuelo IN (SELECT DISTINCT id_vuelo FROM billete)
)
SELECT id_vuelo,
       numero_vuelo,
       capacidad_total,
       pasajeros,
       ROUND(100 * pasajeros / capacidad_total, 1)                         AS factor_ocupacion,
       ROUND(100 * AVG(pasajeros / capacidad_total) OVER (PARTITION BY id_ruta), 1) AS media_de_su_ruta
FROM ocupacion
ORDER BY factor_ocupacion DESC
LIMIT ?

-- Copia literal de sql/04_consultas_avanzadas.sql (Q10).
-- Única diferencia: los valores fijos del original se sustituyen por ? (parámetros)
-- y se quita el ';' final. La prueba test/consultas.sql.test.ts comprueba que,
-- con los valores por defecto, el SQL es idéntico al original.
SELECT p.id_pasajero,
       CONCAT(p.nombre, ' ', p.apellidos)  AS pasajero,
       COUNT(DISTINCT b.id_vuelo)          AS vuelos,
       ROUND(SUM(b.precio), 2)             AS gasto_total
FROM pasajero p
JOIN billete b ON b.id_pasajero = p.id_pasajero
WHERE NOT EXISTS (SELECT 1 FROM billete bc
                   WHERE bc.id_pasajero = p.id_pasajero AND bc.estado = 'cancelado')
GROUP BY p.id_pasajero, p.nombre, p.apellidos
HAVING COUNT(DISTINCT b.id_vuelo) >= ?
ORDER BY gasto_total DESC
LIMIT ?

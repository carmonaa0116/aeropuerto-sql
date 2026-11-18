-- =====================================================================
-- 05_indices.sql
-- Índices justificados con EXPLAIN ANALYZE antes y después (MySQL 8).
-- Resultados y análisis en docs/rendimiento.md.
--
-- Cómo usarlo:
--   1) Con la BD cargada y SIN estos índices, ejecuta el bloque "ANTES"
--      (EXPLAIN ANALYZE de las consultas Q09 y Q10) y apunta los tiempos.
--   2) Ejecuta el bloque "CREAR ÍNDICES".
--   3) Repite el bloque "DESPUÉS" (mismas consultas) y compara.
-- Las consultas son las de sql/04_consultas_avanzadas.sql.
-- =====================================================================
USE aeropuerto;

-- ---------------------------------------------------------------------
-- ANTES / DESPUÉS: pegar aquí la consulta Q09 y la Q10 precedidas de
-- EXPLAIN ANALYZE. Ejemplo con Q10:
-- ---------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT p.id_pasajero,
       CONCAT(p.nombre, ' ', p.apellidos)  AS pasajero,
       COUNT(DISTINCT b.id_vuelo)          AS vuelos,
       ROUND(SUM(b.precio), 2)             AS gasto_total
FROM pasajero p
JOIN billete b ON b.id_pasajero = p.id_pasajero
WHERE NOT EXISTS (SELECT 1 FROM billete bc
                   WHERE bc.id_pasajero = p.id_pasajero AND bc.estado = 'cancelado')
GROUP BY p.id_pasajero, p.nombre, p.apellidos
HAVING COUNT(DISTINCT b.id_vuelo) >= 3
ORDER BY gasto_total DESC
LIMIT 15;

-- ---------------------------------------------------------------------
-- CREAR ÍNDICES
-- ---------------------------------------------------------------------

-- I1. Q09: contar billetes no cancelados de un vuelo.
--     Con (id_vuelo, estado) el COUNT se resuelve solo en el índice
--     (covering), sin leer las filas de billete.
CREATE INDEX idx_billete_vuelo_estado
    ON billete (id_vuelo, estado);

-- I2. Q10: billetes de un pasajero filtrando por estado y sumando precio.
--     Incluye id_vuelo y precio para que la consulta sea covering.
--     Sustituye al índice implícito de la FK id_pasajero (al tener
--     id_pasajero como primera columna, la FK sigue cubierta).
CREATE INDEX idx_billete_pasajero_estado
    ON billete (id_pasajero, estado, id_vuelo, precio);

-- ---------------------------------------------------------------------
-- Índices PROBADOS Y DESCARTADOS (no mejoraron en la medición):
--   vuelo (id_ruta, salida_prevista, estado)  -> Q06 igual (7,9 s)
--   vuelo (estado, id_aeronave)               -> Q01 y Q07 dentro del ruido
-- Cada índice extra penaliza INSERT/UPDATE (y los triggers de vuelo y
-- billete), por eso solo se conservan los que dan ganancia clara.
-- ---------------------------------------------------------------------

-- Para deshacer:
-- DROP INDEX idx_billete_vuelo_estado ON billete;
-- (idx_billete_pasajero_estado: antes crear un índice simple sobre
--  id_pasajero, porque lo usa la FK; después borrarlo)
CREATE INDEX idx_billete_vuelo_estado ON billete (id_vuelo, estado);
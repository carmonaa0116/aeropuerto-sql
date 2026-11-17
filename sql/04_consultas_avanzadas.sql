-- =====================================================================
-- 04_consultas_avanzadas.sql
-- Base de datos: aeropuerto (MySQL 8)
-- Consultas avanzadas con CTE (normales y recursivas), funciones ventana
-- y subconsultas. Cada consulta responde a una pregunta de negocio.
--
-- Notas de datos:
--  * Los vuelos vienen del BTS de enero de 2026 (EE. UU.); las horas
--    están en UTC, así que "día" = DATE(salida_prevista) en UTC.
--  * Retraso de salida (min) = TIMESTAMPDIFF(MINUTE, salida_prevista, salida_real).
--    vuelo.estado = 'retrasado' cuando ese retraso es >= 15 min.
--  * La aerolínea de un vuelo se obtiene de su aeronave.
--  * Solo hay billetes para una muestra de 5.000 vuelos (consultas 8 y 9).
--
-- Ejecutar con: USE aeropuerto; y lanzar cada consulta por separado.
-- =====================================================================
USE aeropuerto;

-- ---------------------------------------------------------------------
-- Q01. Ranking de puntualidad por aerolínea
-- Pregunta: ¿qué aerolíneas son más puntuales y cuánto se separan de la
-- media del conjunto?
-- Técnicas: CTE, RANK(), AVG() OVER () como referencia global.
-- ---------------------------------------------------------------------
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
ORDER BY puesto;

-- ---------------------------------------------------------------------
-- Q02. Aeropuertos de origen por cuartil de retraso medio
-- Pregunta: ¿qué aeropuertos grandes (>= 3.000 salidas) están en el
-- peor cuartil de retraso medio de salida?
-- Técnicas: CTE, NTILE(), AVG sobre TIMESTAMPDIFF.
-- ---------------------------------------------------------------------
WITH salidas AS (
    SELECT r.id_aeropuerto_origen                              AS id_aeropuerto,
           COUNT(*)                                            AS salidas,
           AVG(TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.salida_real)) AS retraso_medio_min
    FROM vuelo v
    JOIN ruta r ON r.id_ruta = v.id_ruta
    WHERE v.estado <> 'cancelado'
    GROUP BY r.id_aeropuerto_origen
    HAVING COUNT(*) >= 3000
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
ORDER BY c.cuartil, c.retraso_medio_min DESC;

-- ---------------------------------------------------------------------
-- Q03. Retrasos en cascada por aeronave (el avión llega tarde y el
-- siguiente vuelo sale tarde)
-- Pregunta: de los vuelos que salen con >= 15 min de retraso, ¿cuántos
-- vienen precedidos por una llegada tardía del mismo avión en el mismo
-- aeropuerto?
-- Técnicas: LAG() por aeronave, CTE, comparación con el vuelo anterior.
-- ---------------------------------------------------------------------
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
WHERE retraso_salida >= 15;

-- ---------------------------------------------------------------------
-- Q04. Media móvil de 7 días del % de retraso (con calendario completo)
-- Pregunta: ¿cómo evoluciona la puntualidad día a día y cuál es la
-- tendencia suavizada? Los días sin vuelos también deben aparecer.
-- Técnicas: CTE RECURSIVA (calendario), LEFT JOIN, AVG() OVER con
-- ventana de filas.
-- ---------------------------------------------------------------------
WITH RECURSIVE calendario AS (
    SELECT DATE('2026-01-01') AS dia
    UNION ALL
    SELECT dia + INTERVAL 1 DAY FROM calendario WHERE dia < '2026-01-31'
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
ORDER BY c.dia;

-- ---------------------------------------------------------------------
-- Q05. Rachas de días malos por aeropuerto (gaps and islands)
-- Pregunta: ¿qué aeropuertos grandes encadenaron más días seguidos con
-- un retraso medio de salida superior a 20 minutos?
-- Técnicas: ROW_NUMBER(), diferencia de fechas como identificador de
-- isla, agregación por isla.
-- ---------------------------------------------------------------------
WITH dia_aeropuerto AS (
    SELECT r.id_aeropuerto_origen                                      AS id_aeropuerto,
           DATE(v.salida_prevista)                                     AS dia,
           COUNT(*)                                                    AS salidas,
           AVG(TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.salida_real)) AS retraso_medio
    FROM vuelo v
    JOIN ruta r ON r.id_ruta = v.id_ruta
    WHERE v.estado <> 'cancelado'
      AND DATE(v.salida_prevista) BETWEEN '2026-01-01' AND '2026-01-31'
    GROUP BY r.id_aeropuerto_origen, DATE(v.salida_prevista)
    HAVING COUNT(*) >= 20
),
malos AS (
    SELECT id_aeropuerto, dia, retraso_medio,
           DATE_SUB(dia, INTERVAL ROW_NUMBER() OVER (PARTITION BY id_aeropuerto ORDER BY dia) DAY) AS isla
    FROM dia_aeropuerto
    WHERE retraso_medio > 20
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
LIMIT 10;

-- ---------------------------------------------------------------------
-- Q06. Conexiones con una escala desde un aeropuerto en un día
-- Pregunta: ¿a qué destinos se puede llegar desde ATL el 15-01-2026
-- con un vuelo directo o enlazando dos, con una conexión de entre 60 min
-- y 4 h, y cuál es el itinerario que llega antes a cada destino? Salen
-- primero los destinos cuya mejor opción es con escala (tramos = 2).
-- Técnicas: CTE RECURSIVA sobre vuelos, control de profundidad
-- (i.tramos < 2), evitar ciclos con la lista de aeropuertos visitados,
-- ROW_NUMBER() para quedarse con el mejor itinerario por destino.
-- Para subir a 2 escalas basta con cambiar i.tramos < 2 por i.tramos < 3,
-- pero el número de itinerarios crece de forma explosiva (minutos).
-- ---------------------------------------------------------------------
WITH RECURSIVE itinerario AS (
    SELECT v.id_vuelo                          AS ultimo_vuelo,
           r.id_aeropuerto_destino             AS aeropuerto_actual,
           v.salida_prevista                   AS salida_inicial,
           v.llegada_prevista                  AS llegada_actual,
           1                                   AS tramos,
           CAST(v.numero_vuelo AS CHAR(100))   AS vuelos,
           CAST(CONCAT(',', r.id_aeropuerto_origen, ',', r.id_aeropuerto_destino, ',') AS CHAR(100)) AS visitados
    FROM vuelo v
    JOIN ruta r        ON r.id_ruta = v.id_ruta
    JOIN aeropuerto ao ON ao.id_aeropuerto = r.id_aeropuerto_origen
    WHERE ao.codigo_iata = 'ATL'
      AND v.estado <> 'cancelado'
      AND v.salida_prevista >= '2026-01-15 00:00:00'
      AND v.salida_prevista <  '2026-01-16 00:00:00'
    UNION ALL
    SELECT v2.id_vuelo, r2.id_aeropuerto_destino, i.salida_inicial, v2.llegada_prevista, i.tramos + 1,
           CONCAT(i.vuelos, ' > ', v2.numero_vuelo),
           CONCAT(i.visitados, r2.id_aeropuerto_destino, ',')
    FROM itinerario i
    JOIN ruta r2  ON r2.id_aeropuerto_origen = i.aeropuerto_actual
    JOIN vuelo v2 ON v2.id_ruta = r2.id_ruta
    WHERE i.tramos < 2
      AND v2.estado <> 'cancelado'
      AND v2.salida_prevista >= i.llegada_actual + INTERVAL 60 MINUTE
      AND v2.salida_prevista <= i.llegada_actual + INTERVAL 4 HOUR
      AND i.visitados NOT LIKE CONCAT('%,', r2.id_aeropuerto_destino, ',%')
),
mejor AS (
    SELECT i.*, TIMESTAMPDIFF(MINUTE, salida_inicial, llegada_actual) AS duracion_min,
           ROW_NUMBER() OVER (PARTITION BY aeropuerto_actual ORDER BY llegada_actual, tramos) AS n
    FROM itinerario i
)
SELECT ap.codigo_iata AS destino, m.tramos, m.vuelos, m.duracion_min
FROM mejor m JOIN aeropuerto ap ON ap.id_aeropuerto = m.aeropuerto_actual
WHERE m.n = 1
ORDER BY m.tramos DESC, m.duracion_min
LIMIT 25;

-- ---------------------------------------------------------------------
-- Q07. Utilización de aeronaves frente a mantenimiento
-- Pregunta: ¿qué aeronaves vuelan más horas y cuánto cuesta mantenerlas?
-- Técnicas: dos CTE agregadas por separado (evita multiplicar filas al
-- unir), LEFT JOIN, subconsulta escalar para la media de la flota.
-- ---------------------------------------------------------------------
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
LIMIT 15;

-- ---------------------------------------------------------------------
-- Q08. Ocupación e ingresos por aerolínea y clase, con subtotales
-- Pregunta: ¿cuánto se ingresa y cuántos billetes se venden por
-- aerolínea y clase de cabina (con total por aerolínea y total global)?
-- Técnicas: GROUP BY ... WITH ROLLUP; COALESCE etiqueta las filas de
-- subtotal (válido porque nombre es NOT NULL en ambas tablas).
-- (solo hay billetes para 5.000 vuelos)
-- ---------------------------------------------------------------------
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
GROUP BY al.nombre, c.nombre WITH ROLLUP;

-- ---------------------------------------------------------------------
-- Q09. Vuelos con mejor y peor factor de ocupación
-- Pregunta: ¿qué vuelos de la muestra van más llenos respecto a la
-- capacidad de su modelo y cómo se comparan con el resto de su ruta?
-- Técnicas: subconsulta correlacionada en el SELECT, CTE,
-- AVG() OVER (PARTITION BY ruta).
-- ---------------------------------------------------------------------
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
LIMIT 15;

-- ---------------------------------------------------------------------
-- Q10. Pasajeros frecuentes sin ninguna cancelación
-- Pregunta: ¿qué pasajeros han volado en 3 o más vuelos distintos de la
-- muestra, con gasto total, y nunca han tenido un billete cancelado?
-- Técnicas: NOT EXISTS, HAVING, agregación con DISTINCT.
-- ---------------------------------------------------------------------
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

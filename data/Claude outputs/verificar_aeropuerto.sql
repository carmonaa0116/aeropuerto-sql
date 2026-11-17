-- =====================================================================
-- VERIFICACIÓN DE LA BASE aeropuerto (MySQL 8)
-- Ejecútalo entero (Workbench: Ctrl+Shift+Enter). Tarda unos minutos por los JOIN sobre ~600k filas.
-- IMPORTANTE en Workbench: Edit > Preferences > SQL Editor > 'DBMS connection read timeout' = 600 (por defecto 30 s
-- y corta las consultas largas con el error 2013 'Lost connection'). Reconecta después de cambiarlo.
-- Al final salen 3 resultados: resumen, solo lo que falla/revisar, y el detalle completo.
-- Los resultados quedan guardados: para volver a verlos sin repetir los cálculos, ejecuta solo los 3 SELECT del final.
--
-- Reglas:  cero   = debe dar 0, si no es FALLO (integridad de tu pipeline)
--          igual  = debe coincidir con 'esperado', si no es FALLO
--          max    = debe ser <= esperado, si no es REVISAR (calidad del dato de origen)
--          info   = solo informativo
-- =====================================================================
USE aeropuerto;

-- Los resultados van a una base aparte (no a una tabla TEMPORARY: Workbench ejecuta los SELECT finales
-- en otra conexión y no la vería). Así tampoco cuenta como tabla de aeropuerto.
CREATE DATABASE IF NOT EXISTS aeropuerto_verif;
DROP TABLE IF EXISTS aeropuerto_verif.verificacion;
CREATE TABLE aeropuerto_verif.verificacion (
    id INT AUTO_INCREMENT PRIMARY KEY,
    seccion VARCHAR(30),
    comprobacion VARCHAR(120),
    regla VARCHAR(5),
    esperado DECIMAL(18,2) NULL,
    valor DECIMAL(18,2) NULL,
    estado VARCHAR(8) NULL
);

-- =====================================================================
-- 1. ESTRUCTURA
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '1 estructura', 'tablas', 'igual', 21, COUNT(*) FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'aeropuerto' AND TABLE_TYPE = 'BASE TABLE' UNION ALL
SELECT '1 estructura', 'claves foráneas', 'igual', 26, COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = 'aeropuerto' UNION ALL
SELECT '1 estructura', 'restricciones CHECK', 'igual', 9, COUNT(*) FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = 'aeropuerto' UNION ALL
SELECT '1 estructura', 'particiones de evento_vuelo (4 si usas el DDL original con PARTITION)', 'info', NULL, COUNT(PARTITION_NAME)
  FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA = 'aeropuerto' AND TABLE_NAME = 'evento_vuelo';

-- =====================================================================
-- 2. CONTEOS (esperados = los de tu carga; ruta ya con el CSV corregido)
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '2 conteos', 'pais', 'igual', 240, COUNT(*) FROM pais UNION ALL
SELECT '2 conteos', 'aeropuerto', 'igual', 5906, COUNT(*) FROM aeropuerto UNION ALL
SELECT '2 conteos', 'aerolinea', 'igual', 1245, COUNT(*) FROM aerolinea UNION ALL
SELECT '2 conteos', 'modelo_aeronave', 'igual', 15, COUNT(*) FROM modelo_aeronave UNION ALL
SELECT '2 conteos', 'clase_cabina', 'igual', 4, COUNT(*) FROM clase_cabina UNION ALL
SELECT '2 conteos', 'aeronave', 'igual', 17143, COUNT(*) FROM aeronave UNION ALL
SELECT '2 conteos', 'terminal', 'igual', 312, COUNT(*) FROM terminal UNION ALL
SELECT '2 conteos', 'pista', 'igual', 7276, COUNT(*) FROM pista UNION ALL
SELECT '2 conteos', 'ruta', 'igual', 36127, COUNT(*) FROM ruta UNION ALL
SELECT '2 conteos', 'puerta_embarque', 'igual', 233, COUNT(*) FROM puerta_embarque UNION ALL
SELECT '2 conteos', 'vuelo', 'igual', 114892, COUNT(*) FROM vuelo UNION ALL
SELECT '2 conteos', 'evento_vuelo', 'igual', 594957, COUNT(*) FROM evento_vuelo UNION ALL
SELECT '2 conteos', 'empleado', 'igual', 19665, COUNT(*) FROM empleado UNION ALL
SELECT '2 conteos', 'tripulacion_vuelo', 'igual', 629145, COUNT(*) FROM tripulacion_vuelo UNION ALL
SELECT '2 conteos', 'pasajero', 'igual', 100000, COUNT(*) FROM pasajero UNION ALL
SELECT '2 conteos', 'reserva', 'igual', 375557, COUNT(*) FROM reserva UNION ALL
SELECT '2 conteos', 'billete', 'igual', 664853, COUNT(*) FROM billete UNION ALL
SELECT '2 conteos', 'tarjeta_embarque', 'igual', 589071, COUNT(*) FROM tarjeta_embarque UNION ALL
SELECT '2 conteos', 'equipaje', 'igual', 335035, COUNT(*) FROM equipaje UNION ALL
SELECT '2 conteos', 'mantenimiento', 'igual', 12273, COUNT(*) FROM mantenimiento UNION ALL
SELECT '2 conteos', 'incidencia', 'igual', 12319, COUNT(*) FROM incidencia;

-- =====================================================================
-- 3. INTEGRIDAD Y DUPLICADOS
--    (PK, UNIQUE y FK ya las garantiza InnoDB; aquí solo lo que MySQL no vigila)
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '3 integridad', 'evento_vuelo con id_vuelo inexistente (no tiene FK)', 'cero', 0, COUNT(*)
  FROM evento_vuelo e LEFT JOIN vuelo v ON v.id_vuelo = e.id_vuelo WHERE v.id_vuelo IS NULL UNION ALL
SELECT '3 integridad', 'evento_vuelo duplicado (mismo vuelo y tipo)', 'cero', 0, COUNT(*)
  FROM (SELECT id_vuelo, tipo_evento FROM evento_vuelo GROUP BY id_vuelo, tipo_evento HAVING COUNT(*) > 1) x;

-- =====================================================================
-- 4. MAESTROS: aeropuerto, aerolinea, ruta
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '4 maestros', 'aeropuerto con latitud/longitud fuera de rango', 'cero', 0, COUNT(*)
  FROM aeropuerto WHERE latitud NOT BETWEEN -90 AND 90 OR longitud NOT BETWEEN -180 AND 180 UNION ALL
SELECT '4 maestros', 'aeropuerto con IATA/ICAO mal formado', 'cero', 0, COUNT(*)
  FROM aeropuerto WHERE codigo_iata COLLATE utf8mb4_0900_as_cs NOT REGEXP '^[A-Z]{3}$'
                     OR codigo_icao COLLATE utf8mb4_0900_as_cs NOT REGEXP '^[A-Z0-9]{4}$' UNION ALL
SELECT '4 maestros', 'aeropuerto sin zona horaria', 'info', NULL, COUNT(*) FROM aeropuerto WHERE zona_horaria IS NULL UNION ALL
SELECT '4 maestros', 'aerolinea con IATA mal formado', 'cero', 0, COUNT(*)
  FROM aerolinea WHERE codigo_iata COLLATE utf8mb4_0900_as_cs NOT REGEXP '^[A-Z0-9]{2}$' UNION ALL
SELECT '4 maestros', 'ruta con distancia <= 1 km (el fallo que había)', 'cero', 0, COUNT(*) FROM ruta WHERE distancia_km <= 1 UNION ALL
SELECT '4 maestros', 'ruta con distancia distinta a la real entre aeropuertos (> 2 km)', 'cero', 0, COUNT(*)
  FROM ruta r
  JOIN aeropuerto o ON o.id_aeropuerto = r.id_aeropuerto_origen
  JOIN aeropuerto d ON d.id_aeropuerto = r.id_aeropuerto_destino
 WHERE ABS(r.distancia_km - ST_Distance_Sphere(POINT(o.longitud, o.latitud), POINT(d.longitud, d.latitud)) / 1000) > 2 UNION ALL
SELECT '4 maestros', 'distancia media de ruta (km)', 'info', NULL, ROUND(AVG(distancia_km)) FROM ruta;

-- =====================================================================
-- 5. VUELOS
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'cancelado con horas reales', 'cero', 0, COUNT(*)
  FROM vuelo WHERE estado = 'cancelado' AND (salida_real IS NOT NULL OR llegada_real IS NOT NULL);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'no cancelado sin horas reales', 'cero', 0, COUNT(*)
  FROM vuelo WHERE estado <> 'cancelado' AND (salida_real IS NULL OR llegada_real IS NULL);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'estado retrasado/aterrizado incoherente con el retraso de llegada (15 min)', 'cero', 0, COUNT(*)
  FROM vuelo WHERE (estado = 'retrasado' AND TIMESTAMPDIFF(MINUTE, llegada_prevista, llegada_real) < 15)
                OR (estado = 'aterrizado' AND TIMESTAMPDIFF(MINUTE, llegada_prevista, llegada_real) >= 15);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'llegada real anterior a salida real', 'max', 0, COUNT(*) FROM vuelo WHERE llegada_real <= salida_real;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'vuelos cuyo origen no es EWR/JFK/LGA', 'cero', 0, COUNT(*)
  FROM vuelo v JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN aeropuerto a ON a.id_aeropuerto = r.id_aeropuerto_origen
 WHERE a.codigo_iata NOT IN ('EWR', 'JFK', 'LGA');

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'numero_vuelo no empieza por el IATA de la aerolínea de la aeronave', 'cero', 0, COUNT(*)
  FROM vuelo v JOIN aeronave a ON a.id_aeronave = v.id_aeronave
  JOIN aerolinea l ON l.id_aerolinea = a.id_aerolinea
 WHERE v.numero_vuelo NOT LIKE CONCAT(l.codigo_iata, '%');

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'puerta que no es del aeropuerto de origen', 'cero', 0, COUNT(*)
  FROM vuelo v JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN puerta_embarque p ON p.id_puerta = v.id_puerta
  JOIN terminal t ON t.id_terminal = p.id_terminal
 WHERE t.id_aeropuerto <> r.id_aeropuerto_origen;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'pista que no es del aeropuerto de origen', 'cero', 0, COUNT(*)
  FROM vuelo v JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN pista p ON p.id_pista = v.id_pista
 WHERE p.id_aeropuerto <> r.id_aeropuerto_origen;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'misma puerta con salidas a menos de 45 min', 'cero', 0, COUNT(*)
  FROM (SELECT salida_prevista,
               LAG(salida_prevista) OVER (PARTITION BY id_puerta ORDER BY salida_prevista) AS anterior
          FROM vuelo WHERE id_puerta IS NOT NULL) x
 WHERE TIMESTAMPDIFF(MINUTE, anterior, salida_prevista) < 45;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'misma aeronave en dos vuelos solapados (horas reales)', 'max', 0, COUNT(*)
  FROM (SELECT COALESCE(salida_real, salida_prevista) AS salida,
               LAG(COALESCE(llegada_real, llegada_prevista)) OVER (PARTITION BY id_aeronave ORDER BY salida_prevista) AS fin_anterior
          FROM vuelo WHERE estado <> 'cancelado') x
 WHERE fin_anterior > salida;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', 'velocidad implícita fuera de 150-1000 km/h (rutas >= 300 km): revisa husos horarios', 'info', NULL, COUNT(*)
  FROM vuelo v JOIN ruta r ON r.id_ruta = v.id_ruta
 WHERE r.distancia_km >= 300
   AND (r.distancia_km / NULLIF(TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.llegada_prevista) / 60, 0) > 1000
     OR r.distancia_km / NULLIF(TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.llegada_prevista) / 60, 0) < 150);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', '% de vuelos con puerta asignada', 'info', NULL, ROUND(100 * SUM(id_puerta IS NOT NULL) / COUNT(*), 1) FROM vuelo;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '5 vuelo', '% de vuelos con pista asignada', 'info', NULL, ROUND(100 * SUM(id_pista IS NOT NULL) / COUNT(*), 1) FROM vuelo;

-- =====================================================================
-- 6. EVENTOS DE VUELO
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '6 evento', 'vuelos operados sin los 5 eventos base', 'cero', 0, COUNT(*)
  FROM (SELECT v.id_vuelo
          FROM vuelo v
          LEFT JOIN evento_vuelo e ON e.id_vuelo = v.id_vuelo
           AND e.tipo_evento IN ('checkin_abierto', 'embarque_iniciado', 'puerta_cerrada', 'salida_puerta', 'llegada_puerta')
         WHERE v.estado <> 'cancelado'
         GROUP BY v.id_vuelo HAVING COUNT(e.id_evento) <> 5) x;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '6 evento', 'vuelos cancelados sin evento vuelo_cancelado', 'cero', 0, COUNT(*)
  FROM vuelo v WHERE v.estado = 'cancelado'
   AND NOT EXISTS (SELECT 1 FROM evento_vuelo e WHERE e.id_vuelo = v.id_vuelo AND e.tipo_evento = 'vuelo_cancelado');

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '6 evento', 'vuelos cancelados con eventos de operación', 'cero', 0, COUNT(*)
  FROM evento_vuelo e JOIN vuelo v ON v.id_vuelo = e.id_vuelo
 WHERE v.estado = 'cancelado' AND e.tipo_evento <> 'vuelo_cancelado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '6 evento', 'retraso >= 15 min sin evento retraso_notificado', 'cero', 0, COUNT(*)
  FROM vuelo v WHERE v.estado <> 'cancelado' AND TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.salida_real) >= 15
   AND NOT EXISTS (SELECT 1 FROM evento_vuelo e WHERE e.id_vuelo = v.id_vuelo AND e.tipo_evento = 'retraso_notificado');

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '6 evento', 'retraso_notificado en vuelos con retraso < 15 min', 'cero', 0, COUNT(*)
  FROM evento_vuelo e JOIN vuelo v ON v.id_vuelo = e.id_vuelo
 WHERE e.tipo_evento = 'retraso_notificado' AND TIMESTAMPDIFF(MINUTE, v.salida_prevista, v.salida_real) < 15;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '6 evento', 'eventos de un vuelo en orden cronológico incorrecto', 'max', 0, COUNT(*)
  FROM (SELECT id_vuelo,
               MAX(CASE WHEN tipo_evento = 'checkin_abierto'   THEN fecha_hora END) AS a,
               MAX(CASE WHEN tipo_evento = 'embarque_iniciado' THEN fecha_hora END) AS b,
               MAX(CASE WHEN tipo_evento = 'puerta_cerrada'    THEN fecha_hora END) AS c,
               MAX(CASE WHEN tipo_evento = 'salida_puerta'     THEN fecha_hora END) AS d,
               MAX(CASE WHEN tipo_evento = 'llegada_puerta'    THEN fecha_hora END) AS e
          FROM evento_vuelo GROUP BY id_vuelo) x
 WHERE a IS NOT NULL AND NOT (a < b AND b < c AND c < d AND d < e);

-- =====================================================================
-- 7. PERSONAL Y TRIPULACIÓN
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'aerolíneas con algún rol con menos de 4 empleados', 'cero', 0, COUNT(*)
  FROM (SELECT id_aerolinea FROM empleado GROUP BY id_aerolinea
        HAVING SUM(rol = 'piloto') < 4 OR SUM(rol = 'copiloto') < 4 OR SUM(rol = 'tcp') < 4 OR SUM(rol = 'mecanico') < 4) x;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'licencia con prefijo que no corresponde al rol', 'cero', 0, COUNT(*)
  FROM empleado WHERE NOT ((rol = 'piloto' AND licencia LIKE 'ATPL-%') OR (rol = 'copiloto' AND licencia LIKE 'CPL-%')
                        OR (rol = 'tcp' AND licencia LIKE 'CCA-%') OR (rol = 'mecanico' AND licencia LIKE 'B1-%'));

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'vuelos de aerolíneas sin ningún empleado', 'cero', 0, COUNT(*)
  FROM vuelo v JOIN aeronave a ON a.id_aeronave = v.id_aeronave
 WHERE NOT EXISTS (SELECT 1 FROM empleado e WHERE e.id_aerolinea = a.id_aerolinea);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'tripulación de vuelos cancelados', 'cero', 0, COUNT(*)
  FROM tripulacion_vuelo t JOIN vuelo v ON v.id_vuelo = t.id_vuelo WHERE v.estado = 'cancelado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'tripulante de otra aerolínea que la de la aeronave', 'cero', 0, COUNT(*)
  FROM tripulacion_vuelo t
  JOIN vuelo v ON v.id_vuelo = t.id_vuelo
  JOIN aeronave a ON a.id_aeronave = v.id_aeronave
  JOIN empleado e ON e.id_empleado = t.id_empleado
 WHERE e.id_aerolinea <> a.id_aerolinea;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'función que no corresponde al rol del empleado', 'cero', 0, COUNT(*)
  FROM tripulacion_vuelo t JOIN empleado e ON e.id_empleado = t.id_empleado
 WHERE NOT ((t.funcion = 'comandante' AND e.rol = 'piloto') OR (t.funcion = 'copiloto' AND e.rol = 'copiloto')
         OR (t.funcion IN ('jefe_cabina', 'tcp') AND e.rol = 'tcp'));

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'empleado en dos vuelos sin respetar presentación + descanso', 'cero', 0, COUNT(*)
  FROM (SELECT v.salida_prevista,
               LAG(COALESCE(v.llegada_real, v.llegada_prevista)) OVER (PARTITION BY t.id_empleado ORDER BY v.salida_prevista) AS fin_anterior
          FROM tripulacion_vuelo t JOIN vuelo v ON v.id_vuelo = t.id_vuelo) x
 WHERE fin_anterior > salida_prevista - INTERVAL 105 MINUTE;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'vuelos operados sin comandante', 'max', 0, COUNT(*)
  FROM vuelo v WHERE v.estado <> 'cancelado'
   AND NOT EXISTS (SELECT 1 FROM tripulacion_vuelo t WHERE t.id_vuelo = v.id_vuelo AND t.funcion = 'comandante');

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'vuelos operados sin copiloto', 'max', 0, COUNT(*)
  FROM vuelo v WHERE v.estado <> 'cancelado'
   AND NOT EXISTS (SELECT 1 FROM tripulacion_vuelo t WHERE t.id_vuelo = v.id_vuelo AND t.funcion = 'copiloto');

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '7 personal', 'vuelos operados sin jefe de cabina', 'max', 0, COUNT(*)
  FROM vuelo v WHERE v.estado <> 'cancelado'
   AND NOT EXISTS (SELECT 1 FROM tripulacion_vuelo t WHERE t.id_vuelo = v.id_vuelo AND t.funcion = 'jefe_cabina');

-- =====================================================================
-- 8. PASAJEROS
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', 'documento con formato inválido (ni DNI ni pasaporte)', 'cero', 0, COUNT(*)
  FROM pasajero WHERE documento NOT REGEXP '^[0-9]{8}[A-Z]$' AND documento NOT REGEXP '^[A-Z]{2}[0-9]{7}$';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', 'DNI con letra de control incorrecta', 'cero', 0, COUNT(*)
  FROM pasajero WHERE documento REGEXP '^[0-9]{8}[A-Z]$'
   AND SUBSTRING('TRWAGMYFPDXBNJZSQVHLCKE', (CAST(LEFT(documento, 8) AS UNSIGNED) MOD 23) + 1, 1) <> RIGHT(documento, 1);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', 'nacido después de la primera salida', 'cero', 0, COUNT(*)
  FROM pasajero WHERE fecha_nacimiento > (SELECT MIN(salida_prevista) FROM vuelo);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', 'email con formato inválido', 'cero', 0, COUNT(*)
  FROM pasajero WHERE email IS NOT NULL AND email NOT REGEXP '^[^@ ]+@[^@ ]+[.][a-z]+$';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', '% sin email (esperado ~8)', 'info', NULL, ROUND(100 * SUM(email IS NULL) / COUNT(*), 1) FROM pasajero;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', '% nacionalidad España (esperado ~55)', 'info', NULL, ROUND(100 * SUM(p.codigo_iso = 'ES') / COUNT(*), 1)
  FROM pasajero s JOIN pais p ON p.id_pais = s.id_pais;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', 'edad mínima en la primera salida (años)', 'info', NULL,
       TIMESTAMPDIFF(YEAR, MAX(fecha_nacimiento), (SELECT MIN(salida_prevista) FROM vuelo)) FROM pasajero;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '8 pasajero', 'edad máxima en la primera salida (años)', 'info', NULL,
       TIMESTAMPDIFF(YEAR, MIN(fecha_nacimiento), (SELECT MIN(salida_prevista) FROM vuelo)) FROM pasajero;

-- =====================================================================
-- 9. RESERVAS Y BILLETES
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'reservas sin billetes', 'cero', 0, COUNT(*)
  FROM reserva r WHERE NOT EXISTS (SELECT 1 FROM billete b WHERE b.id_reserva = r.id_reserva);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'titular que no viaja en su propia reserva', 'cero', 0, COUNT(*)
  FROM reserva r WHERE NOT EXISTS (SELECT 1 FROM billete b WHERE b.id_reserva = r.id_reserva AND b.id_pasajero = r.id_pasajero_titular);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'titular menor de edad', 'cero', 0, COUNT(*)
  FROM reserva r JOIN pasajero p ON p.id_pasajero = r.id_pasajero_titular
 WHERE p.fecha_nacimiento > (SELECT MIN(salida_prevista) FROM vuelo) - INTERVAL 18 YEAR;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'reserva cancelada con billetes no cancelados', 'cero', 0, COUNT(*)
  FROM reserva r JOIN billete b ON b.id_reserva = r.id_reserva WHERE r.estado = 'cancelada' AND b.estado <> 'cancelado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'importe_total distinto de la suma de billetes no cancelados', 'cero', 0, COUNT(*)
  FROM reserva r
  LEFT JOIN (SELECT id_reserva, SUM(precio) AS total FROM billete WHERE estado <> 'cancelado' GROUP BY id_reserva) b
         ON b.id_reserva = r.id_reserva
 WHERE ABS(r.importe_total - COALESCE(b.total, 0)) > 0.01;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'reserva hecha después de la salida del vuelo', 'cero', 0, COUNT(*)
  FROM reserva r
  JOIN (SELECT b.id_reserva, MIN(v.salida_prevista) AS salida
          FROM billete b JOIN vuelo v ON v.id_vuelo = b.id_vuelo GROUP BY b.id_reserva) x ON x.id_reserva = r.id_reserva
 WHERE r.fecha_reserva > x.salida;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'billete cancelado con asiento', 'cero', 0, COUNT(*) FROM billete WHERE estado = 'cancelado' AND asiento IS NOT NULL;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'billete no cancelado sin asiento', 'cero', 0, COUNT(*) FROM billete WHERE estado <> 'cancelado' AND asiento IS NULL;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'billetes no cancelados en vuelos cancelados', 'cero', 0, COUNT(*)
  FROM billete b JOIN vuelo v ON v.id_vuelo = b.id_vuelo WHERE v.estado = 'cancelado' AND b.estado <> 'cancelado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'vuelos con overbooking (billetes > capacidad del modelo)', 'cero', 0, COUNT(*)
  FROM (SELECT id_vuelo, COUNT(*) AS n FROM billete WHERE estado <> 'cancelado' GROUP BY id_vuelo) x
  JOIN vuelo v ON v.id_vuelo = x.id_vuelo
  JOIN aeronave a ON a.id_aeronave = v.id_aeronave
  JOIN modelo_aeronave m ON m.id_modelo = a.id_modelo
 WHERE x.n > m.capacidad_total;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'pasajero en dos vuelos solapados', 'cero', 0, COUNT(*)
  FROM (SELECT v.salida_prevista,
               LAG(v.llegada_prevista) OVER (PARTITION BY b.id_pasajero ORDER BY v.salida_prevista) AS llegada_anterior
          FROM billete b JOIN vuelo v ON v.id_vuelo = b.id_vuelo WHERE b.estado <> 'cancelado') x
 WHERE llegada_anterior > salida_prevista;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'vuelos con billetes (esperado <= 5000)', 'max', 5000, COUNT(DISTINCT id_vuelo) FROM billete;

-- Precios: tras corregir ruta.csv deben crecer con la distancia
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'precio medio turista, ruta < 500 km', 'info', NULL, ROUND(AVG(IF(r.distancia_km < 500, b.precio, NULL)), 2)
  FROM billete b JOIN vuelo v ON v.id_vuelo = b.id_vuelo JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN clase_cabina c ON c.id_clase = b.id_clase WHERE c.nombre = 'Turista';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'precio medio turista, ruta 500-3000 km', 'info', NULL, ROUND(AVG(IF(r.distancia_km BETWEEN 500 AND 3000, b.precio, NULL)), 2)
  FROM billete b JOIN vuelo v ON v.id_vuelo = b.id_vuelo JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN clase_cabina c ON c.id_clase = b.id_clase WHERE c.nombre = 'Turista';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'precio medio turista, ruta > 3000 km', 'info', NULL, ROUND(AVG(IF(r.distancia_km > 3000, b.precio, NULL)), 2)
  FROM billete b JOIN vuelo v ON v.id_vuelo = b.id_vuelo JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN clase_cabina c ON c.id_clase = b.id_clase WHERE c.nombre = 'Turista';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '9 ventas', 'el precio crece con la distancia (1 = sí)', 'igual', 1,
       AVG(IF(r.distancia_km < 500, b.precio, NULL)) < AVG(IF(r.distancia_km > 3000, b.precio, NULL))
  FROM billete b JOIN vuelo v ON v.id_vuelo = b.id_vuelo JOIN ruta r ON r.id_ruta = v.id_ruta
  JOIN clase_cabina c ON c.id_clase = b.id_clase WHERE c.nombre = 'Turista';

-- =====================================================================
-- 10. TARJETAS DE EMBARQUE Y EQUIPAJE
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '10 embarque', 'tarjeta de un billete que no está embarcado', 'cero', 0, COUNT(*)
  FROM tarjeta_embarque t JOIN billete b ON b.id_billete = t.id_billete WHERE b.estado <> 'embarcado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '10 embarque', 'billete embarcado sin tarjeta', 'cero', 0, COUNT(*)
  FROM billete b WHERE b.estado = 'embarcado' AND NOT EXISTS (SELECT 1 FROM tarjeta_embarque t WHERE t.id_billete = b.id_billete);

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '10 embarque', 'embarque antes del check-in', 'cero', 0, COUNT(*) FROM tarjeta_embarque WHERE hora_embarque < fecha_checkin;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '10 embarque', 'check-in o embarque después de la salida real', 'cero', 0, COUNT(*)
  FROM tarjeta_embarque t JOIN billete b ON b.id_billete = t.id_billete JOIN vuelo v ON v.id_vuelo = b.id_vuelo
 WHERE t.fecha_checkin > v.salida_real OR t.hora_embarque > v.salida_real;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '10 embarque', 'equipaje de un billete no embarcado', 'cero', 0, COUNT(*)
  FROM equipaje e JOIN billete b ON b.id_billete = e.id_billete WHERE b.estado <> 'embarcado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '10 embarque', 'equipaje con peso fuera de 2-32 kg', 'cero', 0, COUNT(*) FROM equipaje WHERE peso_kg NOT BETWEEN 2 AND 32;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '10 embarque', 'maletas perdidas por mil (esperado ~6)', 'info', NULL, ROUND(1000 * SUM(estado = 'perdido') / COUNT(*), 1) FROM equipaje;

-- =====================================================================
-- 11. MANTENIMIENTO E INCIDENCIAS
-- =====================================================================
INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '11 mant/incid', 'mantenimiento que se solapa con un vuelo de la misma aeronave', 'cero', 0, COUNT(*)
  FROM mantenimiento m JOIN vuelo v ON v.id_aeronave = m.id_aeronave
 WHERE m.fecha_inicio < COALESCE(v.llegada_real, v.llegada_prevista)
   AND COALESCE(m.fecha_fin, CAST('9999-12-31 00:00:00' AS DATETIME)) > v.salida_prevista;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '11 mant/incid', 'mantenimientos solapados de la misma aeronave', 'cero', 0, COUNT(*)
  FROM (SELECT fecha_inicio,
               LAG(COALESCE(fecha_fin, CAST('9999-12-31 00:00:00' AS DATETIME))) OVER (PARTITION BY id_aeronave ORDER BY fecha_inicio) AS fin_anterior
          FROM mantenimiento) x
 WHERE fin_anterior > fecha_inicio;

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '11 mant/incid', 'orden abierta en aeronave que no está en mantenimiento', 'cero', 0, COUNT(*)
  FROM mantenimiento m JOIN aeronave a ON a.id_aeronave = m.id_aeronave
 WHERE m.fecha_fin IS NULL AND a.estado <> 'mantenimiento';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '11 mant/incid', 'incidencia Retraso en vuelo no retrasado', 'cero', 0, COUNT(*)
  FROM incidencia i JOIN vuelo v ON v.id_vuelo = i.id_vuelo WHERE i.tipo = 'Retraso' AND v.estado <> 'retrasado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '11 mant/incid', 'incidencia Cancelación en vuelo no cancelado', 'cero', 0, COUNT(*)
  FROM incidencia i JOIN vuelo v ON v.id_vuelo = i.id_vuelo WHERE i.tipo = 'Cancelación de vuelo' AND v.estado <> 'cancelado';

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '11 mant/incid', 'vuelos cancelados sin incidencia de cancelación', 'cero', 0, COUNT(*)
  FROM vuelo v WHERE v.estado = 'cancelado'
   AND NOT EXISTS (SELECT 1 FROM incidencia i WHERE i.id_vuelo = v.id_vuelo AND i.tipo = 'Cancelación de vuelo');

INSERT INTO aeropuerto_verif.verificacion (seccion, comprobacion, regla, esperado, valor)
SELECT '11 mant/incid', 'incidencias de gravedad crítica', 'info', NULL, COUNT(*) FROM incidencia WHERE gravedad = 'critica';

-- =====================================================================
-- RESULTADO
-- =====================================================================
UPDATE aeropuerto_verif.verificacion SET estado = CASE regla
    WHEN 'cero'  THEN IF(valor = 0, 'OK', 'FALLO')
    WHEN 'igual' THEN IF(valor = esperado, 'OK', 'FALLO')
    WHEN 'max'   THEN IF(valor <= esperado, 'OK', 'REVISAR')
    ELSE 'INFO' END
WHERE id > 0;  -- el WHERE sobre la clave evita el error 1175 del modo seguro de Workbench

-- 1) Resumen
SELECT estado, COUNT(*) AS comprobaciones FROM aeropuerto_verif.verificacion GROUP BY estado ORDER BY FIELD(estado, 'FALLO', 'REVISAR', 'OK', 'INFO');

-- 2) Solo lo que hay que mirar
SELECT id, seccion, comprobacion, regla, esperado, valor, estado FROM aeropuerto_verif.verificacion WHERE estado IN ('FALLO', 'REVISAR') ORDER BY id;

-- 3) Detalle completo
SELECT id, seccion, comprobacion, regla, esperado, valor, estado FROM aeropuerto_verif.verificacion ORDER BY id;

-- Cuando termines de revisar, para borrar los resultados:
-- DROP DATABASE aeropuerto_verif;

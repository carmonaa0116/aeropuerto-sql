-- =====================================================================
-- app/backend/sql/01_demo_triggers.sql
-- Demo de triggers en vivo (página "Demo de triggers" de la app, fase 3).
--
-- sp_demo_trigger(caso) prueba UNA regla de los triggers de sql/01-03:
--   1. START TRANSACTION
--   2. [preparacion] crea sus propios datos de prueba, marcados: códigos que
--      empiezan por '#', matrículas TEST-D*, documentos DEMO-*, año 2030
--   3. [caso:...] lanza la sentencia que el trigger debe rechazar (o aceptar,
--      en el caso 'valido')
--   4. ROLLBACK SIEMPRE, haya error o no. Nada queda en la base.
--   5. Devuelve una fila: caso, paso, resultado, errno, estado_sql, mensaje
--      (el error REAL, leído con GET DIAGNOSTICS).
--
-- Mismo enfoque que sql/99_tests_triggers.sql, pero un caso por llamada y con
-- marcas propias ('#D', TEST-D*) para no chocar con aquel.
--
-- SQL SECURITY DEFINER: se ejecuta con los permisos de quien lo crea (root).
-- Por eso app_rw solo necesita EXECUTE sobre este procedimiento, no INSERT en
-- pais, aeropuerto, billete, mantenimiento...
--
-- Nota: un INSERT deshecho con ROLLBACK no deja filas, pero InnoDB no
-- devuelve los valores de AUTO_INCREMENT que gastó. Los id saltan unos
-- números tras cada demo; los COUNT(*) no cambian.
--
-- CÓMO EJECUTARLO (Workbench, conectado como root, una sola vez):
--   1. File > Open SQL Script... y abre este archivo.
--   2. Ejecuta todo con Ctrl+Shift+Enter.
--   3. Al final verás la tabla de la prueba de 'valido' y los permisos de app_rw.
-- Se puede volver a ejecutar (DROP PROCEDURE IF EXISTS).
-- No toca ningún .sql de sql/ ni ningún trigger existente.
-- =====================================================================
USE aeropuerto;

DROP PROCEDURE IF EXISTS sp_demo_trigger;

DELIMITER $$

CREATE PROCEDURE sp_demo_trigger(IN p_caso VARCHAR(30))
    MODIFIES SQL DATA
    SQL SECURITY DEFINER
    COMMENT 'Demo de la app web: prueba una regla de los triggers y hace siempre ROLLBACK'
BEGIN
    DECLARE v_paso VARCHAR(20) DEFAULT 'validacion';
    DECLARE v_errno INT DEFAULT NULL;
    DECLARE v_sqlstate CHAR(5) DEFAULT NULL;
    DECLARE v_msg VARCHAR(512) DEFAULT NULL;
    DECLARE v_pais, v_apA, v_apB, v_tA, v_tB, v_gA1, v_pA1 INT;
    DECLARE v_aero, v_mod, v_ac1, v_ac2, v_ac3, v_ruta, v_clase INT;
    DECLARE v_p1, v_p2, v_p3, v_res, v_emp INT;
    DECLARE v_v1, v_v2, v_v3, v_v4 INT;

    -- Cualquier error (del trigger, de una FK, de un UNIQUE...): se lee tal cual,
    -- se deshace todo y se devuelve. GET DIAGNOSTICS va primero: ROLLBACK lo borraría.
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        GET DIAGNOSTICS CONDITION 1
            v_errno = MYSQL_ERRNO, v_sqlstate = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
        ROLLBACK;
        SELECT p_caso AS caso, v_paso AS paso, 'error' AS resultado,
               v_errno AS errno, v_sqlstate AS estado_sql, v_msg AS mensaje;
    END;

    IF p_caso IS NULL OR p_caso NOT IN ('puerta_ocupada', 'pista_2min', 'aeronave_solapada',
            'aeronave_mantenimiento', 'overbooking', 'billete_vuelo_cancelado',
            'tripulacion_descanso', 'asiento_duplicado', 'valido') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sp_demo_trigger: caso desconocido';
    END IF;

    START TRANSACTION;
    SET v_paso = 'preparacion';

    -- [preparacion]
    -- Infraestructura propia: pais, dos aeropuertos (A y B), terminal, puerta y pista en A
    INSERT INTO pais (codigo_iso, nombre) VALUES ('#D', 'Pais demo (app)');                    SET v_pais = LAST_INSERT_ID();
    INSERT INTO aeropuerto (codigo_iata, codigo_icao, nombre, ciudad, id_pais, latitud, longitud)
        VALUES ('#D1', '#DM1', 'Demo A', 'Demo A', v_pais, 0, 0);                              SET v_apA = LAST_INSERT_ID();
    INSERT INTO aeropuerto (codigo_iata, codigo_icao, nombre, ciudad, id_pais, latitud, longitud)
        VALUES ('#D2', '#DM2', 'Demo B', 'Demo B', v_pais, 1, 1);                              SET v_apB = LAST_INSERT_ID();
    INSERT INTO terminal (id_aeropuerto, nombre) VALUES (v_apA, 'Demo T-A');                   SET v_tA = LAST_INSERT_ID();
    INSERT INTO puerta_embarque (id_terminal, codigo) VALUES (v_tA, '#A1');                    SET v_gA1 = LAST_INSERT_ID();
    INSERT INTO pista (id_aeropuerto, designacion, longitud_m) VALUES (v_apA, '#09/27', 3000); SET v_pA1 = LAST_INSERT_ID();
    INSERT INTO ruta (id_aeropuerto_origen, id_aeropuerto_destino, distancia_km) VALUES (v_apA, v_apB, 150); SET v_ruta = LAST_INSERT_ID();

    -- Flota: un modelo de 2 plazas y tres aeronaves
    INSERT INTO aerolinea (codigo_iata, nombre, id_pais) VALUES ('#D', 'Aerolinea demo (app)', v_pais); SET v_aero = LAST_INSERT_ID();
    INSERT INTO modelo_aeronave (fabricante, nombre, capacidad_total, autonomia_km)
        VALUES ('DemoFab', 'Demo 2 plazas', 2, 1000);                                          SET v_mod = LAST_INSERT_ID();
    INSERT INTO aeronave (matricula, id_modelo, id_aerolinea) VALUES ('TEST-D1', v_mod, v_aero); SET v_ac1 = LAST_INSERT_ID();
    INSERT INTO aeronave (matricula, id_modelo, id_aerolinea) VALUES ('TEST-D2', v_mod, v_aero); SET v_ac2 = LAST_INSERT_ID();
    INSERT INTO aeronave (matricula, id_modelo, id_aerolinea) VALUES ('TEST-D3', v_mod, v_aero); SET v_ac3 = LAST_INSERT_ID();

    -- #D001: TEST-D1, puerta #A1 y pista #09/27, 2030-01-01 10:00-12:00 (UTC)
    --        ocupa la puerta de 09:15 a 10:10 y la pista a las 10:00
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, id_pista, salida_prevista, llegada_prevista)
        VALUES ('#D001', v_ruta, v_ac1, v_gA1, v_pA1, '2030-01-01 10:00', '2030-01-01 12:00');  SET v_v1 = LAST_INSERT_ID();
    -- #D002: TEST-D2, 13:00-14:00, sin puerta ni pista (para el asiento duplicado)
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
        VALUES ('#D002', v_ruta, v_ac2, '2030-01-01 13:00', '2030-01-01 14:00');               SET v_v2 = LAST_INSERT_ID();
    -- #D003: TEST-D3, cancelado (no ocupa nada)
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista, estado)
        VALUES ('#D003', v_ruta, v_ac3, '2030-01-01 10:00', '2030-01-01 11:00', 'cancelado');  SET v_v3 = LAST_INSERT_ID();
    -- #D004: TEST-D3, 13:44-14:30 (presentación de la tripulación a las 12:44)
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
        VALUES ('#D004', v_ruta, v_ac3, '2030-01-01 13:44', '2030-01-01 14:30');               SET v_v4 = LAST_INSERT_ID();

    -- TEST-D1 en revisión todo el 2 de enero
    INSERT INTO mantenimiento (id_aeronave, tipo, fecha_inicio, fecha_fin)
        VALUES (v_ac1, 'revision demo', '2030-01-02 00:00', '2030-01-03 00:00');

    -- Ventas: #D001 lleno (2 de 2 plazas) y #D002 con el asiento 1A vendido
    INSERT INTO clase_cabina (nombre) VALUES ('demo-#');                                       SET v_clase = LAST_INSERT_ID();
    INSERT INTO pasajero (nombre, apellidos, documento, fecha_nacimiento, id_pais) VALUES ('P1', 'Demo', 'DEMO-001', '1990-01-01', v_pais); SET v_p1 = LAST_INSERT_ID();
    INSERT INTO pasajero (nombre, apellidos, documento, fecha_nacimiento, id_pais) VALUES ('P2', 'Demo', 'DEMO-002', '1990-01-01', v_pais); SET v_p2 = LAST_INSERT_ID();
    INSERT INTO pasajero (nombre, apellidos, documento, fecha_nacimiento, id_pais) VALUES ('P3', 'Demo', 'DEMO-003', '1990-01-01', v_pais); SET v_p3 = LAST_INSERT_ID();
    INSERT INTO reserva (localizador, id_pasajero_titular) VALUES ('#DEMO1', v_p1);            SET v_res = LAST_INSERT_ID();
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p1, v_v1, v_clase, '1A', 50);
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p2, v_v1, v_clase, '1B', 50);
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p1, v_v2, v_clase, '1A', 50);

    -- Tripulación: un piloto de comandante en #D001 (ocupado de 09:00 a 12:45)
    INSERT INTO empleado (nombre, apellidos, rol, licencia, id_aerolinea) VALUES ('E', 'Demo', 'piloto', 'DEMO-LIC-1', v_aero); SET v_emp = LAST_INSERT_ID();
    INSERT INTO tripulacion_vuelo (id_vuelo, id_empleado, funcion) VALUES (v_v1, v_emp, 'comandante');
    -- [/preparacion]

    SET v_paso = 'intento';

    CASE p_caso
        -- [caso:puerta_ocupada]
        WHEN 'puerta_ocupada' THEN   -- 10:30 ocupa la puerta de 09:45 a 10:40; #D001 la tiene hasta 10:10
            INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, salida_prevista, llegada_prevista)
                VALUES ('#D101', v_ruta, v_ac2, v_gA1, '2030-01-01 10:30', '2030-01-01 11:30');
        -- [/caso]
        -- [caso:pista_2min]
        WHEN 'pista_2min' THEN       -- 10:01 por la misma pista que #D001 (10:00)
            INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_pista, salida_prevista, llegada_prevista)
                VALUES ('#D102', v_ruta, v_ac2, v_pA1, '2030-01-01 10:01', '2030-01-01 10:50');
        -- [/caso]
        -- [caso:aeronave_solapada]
        WHEN 'aeronave_solapada' THEN   -- TEST-D1 ya vuela #D001 de 10:00 a 12:00
            INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
                VALUES ('#D103', v_ruta, v_ac1, '2030-01-01 11:00', '2030-01-01 12:30');
        -- [/caso]
        -- [caso:aeronave_mantenimiento]
        WHEN 'aeronave_mantenimiento' THEN   -- TEST-D1 está en revisión el 2 de enero
            INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
                VALUES ('#D104', v_ruta, v_ac1, '2030-01-02 10:00', '2030-01-02 11:00');
        -- [/caso]
        -- [caso:overbooking]
        WHEN 'overbooking' THEN      -- #D001 tiene 2 billetes y el modelo 2 plazas
            INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio)
                VALUES (v_res, v_p3, v_v1, v_clase, '1C', 50);
        -- [/caso]
        -- [caso:billete_vuelo_cancelado]
        WHEN 'billete_vuelo_cancelado' THEN   -- #D003 está cancelado
            INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio)
                VALUES (v_res, v_p3, v_v3, v_clase, '2A', 50);
        -- [/caso]
        -- [caso:tripulacion_descanso]
        WHEN 'tripulacion_descanso' THEN   -- se presenta a las 12:44 y sigue ocupado hasta 12:45
            INSERT INTO tripulacion_vuelo (id_vuelo, id_empleado, funcion)
                VALUES (v_v4, v_emp, 'comandante');
        -- [/caso]
        -- [caso:asiento_duplicado]
        WHEN 'asiento_duplicado' THEN   -- el 1A de #D002 ya está vendido (lo rechaza UNIQUE, no un trigger)
            INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio)
                VALUES (v_res, v_p2, v_v2, v_clase, '1A', 50);
        -- [/caso]
        -- [caso:valido]
        WHEN 'valido' THEN           -- puerta libre desde 10:15 (#D001 la suelta a las 10:10), pista y aeronave libres
            INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, id_pista, salida_prevista, llegada_prevista)
                VALUES ('#D105', v_ruta, v_ac2, v_gA1, v_pA1, '2030-01-01 11:00', '2030-01-01 12:00');
        -- [/caso]
    END CASE;

    -- Si llega aquí, la sentencia pasó los triggers. Se deshace igualmente.
    ROLLBACK;
    SELECT p_caso AS caso, v_paso AS paso, 'ok' AS resultado,
           NULL AS errno, NULL AS estado_sql, 'La sentencia pasó todas las validaciones (y se deshizo con ROLLBACK)' AS mensaje;
END$$

DELIMITER ;

-- app_rw solo puede ejecutar este procedimiento (no escribe directamente en las tablas de la demo)
GRANT EXECUTE ON PROCEDURE aeropuerto.sp_demo_trigger TO 'app_rw'@'127.0.0.1';

-- ---------------- comprobación ----------------
CALL sp_demo_trigger('valido');
SHOW GRANTS FOR 'app_rw'@'127.0.0.1';

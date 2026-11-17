-- =====================================================================
-- 99_tests_triggers.sql  --  pruebas de los triggers 01, 02 y 03
--
-- Crea sus propios datos de prueba (codigos que empiezan por '#', matriculas TEST-*) dentro de
-- una transaccion que se DESHACE al final (ROLLBACK): no deja nada en la base.
-- Uso:  CALL sp_test_triggers();   -> tabla con cada caso: esperado vs obtenido.
-- Si algun caso falla por un error distinto de los triggers (FK, CHECK...), el
-- procedimiento se detiene con ese error: es un fallo de la prueba, no del trigger.
-- =====================================================================
USE aeropuerto;
DROP PROCEDURE IF EXISTS sp_test_triggers;

-- Workbench trae activado el 'safe update mode' (error 1175): se apaga solo durante la limpieza
SET SQL_SAFE_UPDATES = 0;

-- ---- Limpieza de restos de ejecuciones anteriores que fallaron a medias ----
-- (solo toca datos de prueba: nombres 'Test A'/'Test B', fabricante 'TestFab', pais de prueba)
DELETE FROM puerta_embarque WHERE id_terminal IN
    (SELECT id_terminal FROM terminal WHERE id_aeropuerto IN
        (SELECT id_aeropuerto FROM aeropuerto WHERE nombre IN ('Test A', 'Test B')));
DELETE FROM pista WHERE id_aeropuerto IN
    (SELECT id_aeropuerto FROM aeropuerto WHERE nombre IN ('Test A', 'Test B'));
DELETE FROM terminal WHERE id_aeropuerto IN
    (SELECT id_aeropuerto FROM aeropuerto WHERE nombre IN ('Test A', 'Test B'));
DELETE FROM aeropuerto WHERE codigo_iata IN ('TS1', 'TS2', '#S1', '#S2') AND nombre IN ('Test A', 'Test B');
DELETE FROM modelo_aeronave WHERE fabricante = 'TestFab';
DELETE FROM pais WHERE codigo_iso IN ('ZQ', '#Q') AND nombre = 'Pais de prueba'
    AND id_pais NOT IN (SELECT id_pais FROM aerolinea)
    AND id_pais NOT IN (SELECT id_pais FROM aeropuerto)
    AND id_pais NOT IN (SELECT id_pais FROM pasajero);   -- solo si nadie lo usa
SET SQL_SAFE_UPDATES = 1;

DELIMITER $$

CREATE PROCEDURE sp_test_triggers()
BEGIN
    DECLARE v_err INT DEFAULT 0;      -- 1 si el ultimo INSERT/UPDATE lo rechazo un trigger
    DECLARE v_dup INT DEFAULT 0;      -- 1 si lo rechazo UNIQUE (error 1062)
    DECLARE v_pais, v_apA, v_apB, v_tA, v_tB, v_gA1, v_gB1, v_pA1, v_pB1 INT;
    DECLARE v_aero, v_mod, v_ac1, v_ac2, v_ac3, v_ruta, v_clase INT;
    DECLARE v_p1, v_p2, v_p3, v_res, v_emp INT;
    DECLARE v_b1, v_b2, v_v1, v_v3, v_v4, v_v12, v_v11 INT;

    -- Ante cualquier error inesperado: deshacer todo (sin transaccion colgada) y mostrar el error
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;
    DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' SET v_err = 1;   -- rechazo de un trigger

    DROP TEMPORARY TABLE IF EXISTS test_resultado;
    -- MEMORY: no transaccional, para que el ROLLBACK no borre los resultados
    CREATE TEMPORARY TABLE test_resultado (
        n INT AUTO_INCREMENT PRIMARY KEY, caso VARCHAR(80), esperado VARCHAR(10), obtenido VARCHAR(10)
    ) ENGINE = MEMORY;

    START TRANSACTION;

    -- ---------------- datos de prueba ----------------
    INSERT INTO pais (codigo_iso, nombre) VALUES ('#Q', 'Pais de prueba');                 SET v_pais = LAST_INSERT_ID();
    INSERT INTO aeropuerto (codigo_iata, codigo_icao, nombre, ciudad, id_pais, latitud, longitud)
        VALUES ('#S1', '#TS1', 'Test A', 'A', v_pais, 0, 0);                                SET v_apA = LAST_INSERT_ID();
    INSERT INTO aeropuerto (codigo_iata, codigo_icao, nombre, ciudad, id_pais, latitud, longitud)
        VALUES ('#S2', '#TS2', 'Test B', 'B', v_pais, 1, 1);                                SET v_apB = LAST_INSERT_ID();
    INSERT INTO terminal (id_aeropuerto, nombre) VALUES (v_apA, 'T-A');                     SET v_tA = LAST_INSERT_ID();
    INSERT INTO terminal (id_aeropuerto, nombre) VALUES (v_apB, 'T-B');                     SET v_tB = LAST_INSERT_ID();
    INSERT INTO puerta_embarque (id_terminal, codigo) VALUES (v_tA, 'A1');                  SET v_gA1 = LAST_INSERT_ID();
    INSERT INTO puerta_embarque (id_terminal, codigo) VALUES (v_tB, 'B1');                  SET v_gB1 = LAST_INSERT_ID();
    INSERT INTO pista (id_aeropuerto, designacion, longitud_m) VALUES (v_apA, '09/27', 3000); SET v_pA1 = LAST_INSERT_ID();
    INSERT INTO pista (id_aeropuerto, designacion, longitud_m) VALUES (v_apB, '09/27', 3000); SET v_pB1 = LAST_INSERT_ID();
    INSERT INTO aerolinea (codigo_iata, nombre, id_pais) VALUES ('#Z', 'Aerolinea de prueba', v_pais); SET v_aero = LAST_INSERT_ID();
    INSERT INTO modelo_aeronave (fabricante, nombre, capacidad_total, autonomia_km)
        VALUES ('TestFab', 'TestModel', 2, 1000);                                           SET v_mod = LAST_INSERT_ID();   -- capacidad 2
    INSERT INTO aeronave (matricula, id_modelo, id_aerolinea) VALUES ('TEST-AC1', v_mod, v_aero); SET v_ac1 = LAST_INSERT_ID();
    INSERT INTO aeronave (matricula, id_modelo, id_aerolinea) VALUES ('TEST-AC2', v_mod, v_aero); SET v_ac2 = LAST_INSERT_ID();
    INSERT INTO aeronave (matricula, id_modelo, id_aerolinea) VALUES ('TEST-AC3', v_mod, v_aero); SET v_ac3 = LAST_INSERT_ID();
    INSERT INTO ruta (id_aeropuerto_origen, id_aeropuerto_destino, distancia_km) VALUES (v_apA, v_apB, 150); SET v_ruta = LAST_INSERT_ID();
    INSERT INTO clase_cabina (nombre) VALUES ('ZQ-test');                                   SET v_clase = LAST_INSERT_ID();
    INSERT INTO pasajero (nombre, apellidos, documento, fecha_nacimiento, id_pais) VALUES ('P1', 'Test', 'TST-001', '1990-01-01', v_pais); SET v_p1 = LAST_INSERT_ID();
    INSERT INTO pasajero (nombre, apellidos, documento, fecha_nacimiento, id_pais) VALUES ('P2', 'Test', 'TST-002', '1990-01-01', v_pais); SET v_p2 = LAST_INSERT_ID();
    INSERT INTO pasajero (nombre, apellidos, documento, fecha_nacimiento, id_pais) VALUES ('P3', 'Test', 'TST-003', '1990-01-01', v_pais); SET v_p3 = LAST_INSERT_ID();
    INSERT INTO reserva (localizador, id_pasajero_titular) VALUES ('TSTZQ1', v_p1);        SET v_res = LAST_INSERT_ID();
    INSERT INTO empleado (nombre, apellidos, rol, licencia, id_aerolinea) VALUES ('E', 'Test', 'piloto', 'TST-LIC-1', v_aero); SET v_emp = LAST_INSERT_ID();

    -- ============ PUERTA ============
    -- V1: AC1, puerta A1, pista A1, 10:00-12:00 (ocupa la puerta de 09:15 a 10:10)
    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, id_pista, salida_prevista, llegada_prevista)
        VALUES ('TS001', v_ruta, v_ac1, v_gA1, v_pA1, '2030-01-01 10:00', '2030-01-01 12:00');
    SET v_v1 = LAST_INSERT_ID();
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Vuelo base valido', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, salida_prevista, llegada_prevista)
        VALUES ('TS002', v_ruta, v_ac2, v_gA1, '2030-01-01 10:30', '2030-01-01 11:30');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Puerta: solape con otro vuelo', 'error', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, salida_prevista, llegada_prevista)
        VALUES ('TS003', v_ruta, v_ac2, v_gA1, '2030-01-01 11:00', '2030-01-01 13:00');
    SET v_v3 = LAST_INSERT_ID();
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Puerta: vuelo posterior sin solape', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, salida_prevista, llegada_prevista)
        VALUES ('TS004', v_ruta, v_ac3, v_gB1, '2030-01-02 10:00', '2030-01-02 11:00');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Puerta de otro aeropuerto', 'error', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    UPDATE vuelo SET salida_real = '2030-01-01 11:30' WHERE id_vuelo = v_v1;   -- el retraso ocupa la puerta hasta 11:40
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Puerta: retraso real que invade otro vuelo', 'error', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_puerta, salida_prevista, llegada_prevista, estado)
        VALUES ('TS005', v_ruta, v_ac3, v_gA1, '2030-01-01 10:00', '2030-01-01 11:00', 'cancelado');
    SET v_v4 = LAST_INSERT_ID();
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Puerta: vuelo cancelado no bloquea', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    UPDATE vuelo SET estado = 'embarcando' WHERE id_vuelo = v_v1;
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('UPDATE inocuo (solo estado) permitido', 'ok', IF(v_err, 'error', 'ok'));

    -- ============ PISTA (V1 sale por la pista A1 a las 10:00) ============
    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_pista, salida_prevista, llegada_prevista)
        VALUES ('TS006', v_ruta, v_ac2, v_pA1, '2030-01-01 10:01', '2030-01-01 10:50');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Pista: salida a 1 min de otra', 'error', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_pista, salida_prevista, llegada_prevista)
        VALUES ('TS007', v_ruta, v_ac2, v_pA1, '2030-01-01 10:02', '2030-01-01 10:50');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Pista: salida a exactamente 2 min', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, id_pista, salida_prevista, llegada_prevista)
        VALUES ('TS008', v_ruta, v_ac3, v_pB1, '2030-01-03 10:00', '2030-01-03 11:00');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Pista de otro aeropuerto', 'error', IF(v_err, 'error', 'ok'));

    -- ============ AERONAVE (AC1 vuela V1 de 10:00 a 12:00) ============
    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
        VALUES ('TS009', v_ruta, v_ac1, '2030-01-01 11:00', '2030-01-01 12:30');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Aeronave en dos vuelos a la vez', 'error', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
        VALUES ('TS010', v_ruta, v_ac1, '2030-01-01 12:00', '2030-01-01 13:00');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Aeronave: vuelos que solo se tocan', 'ok', IF(v_err, 'error', 'ok'));

    INSERT INTO mantenimiento (id_aeronave, tipo, fecha_inicio, fecha_fin) VALUES (v_ac1, 'revision', '2030-01-02 00:00', '2030-01-03 00:00');
    SET v_err = 0;
    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
        VALUES ('TS011', v_ruta, v_ac1, '2030-01-02 10:00', '2030-01-02 11:00');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Aeronave en mantenimiento', 'error', IF(v_err, 'error', 'ok'));

    -- ============ BILLETES (capacidad del modelo = 2; vuelo V1) ============
    SET v_err = 0;
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p1, v_v1, v_clase, '1A', 50);
    SET v_b1 = LAST_INSERT_ID();
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Billete 1 de 2 plazas', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p2, v_v1, v_clase, '1B', 50);
    SET v_b2 = LAST_INSERT_ID();
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Billete 2 de 2 plazas', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p3, v_v1, v_clase, '1C', 50);
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Overbooking: billete 3 de 2 plazas', 'error', IF(v_err, 'error', 'ok'));

    UPDATE billete SET estado = 'cancelado' WHERE id_billete = v_b2;
    INSERT INTO test_resultado (caso, esperado, obtenido)
        SELECT 'Cancelar libera el asiento (asiento NULL)', 'ok', IF(asiento IS NULL, 'ok', 'error') FROM billete WHERE id_billete = v_b2;

    SET v_dup = 0;
    BEGIN   -- el manejador del 1062 solo vale para este caso: si fallara un dato de prueba, que se vea
        DECLARE CONTINUE HANDLER FOR 1062 SET v_dup = 1;
        INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p3, v_v1, v_clase, '1A', 50);
    END;
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Asiento duplicado (UNIQUE vuelo+asiento)', 'error', IF(v_dup, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p3, v_v1, v_clase, '1B', 50);
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Reventa del asiento liberado', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO billete (id_reserva, id_pasajero, id_vuelo, id_clase, asiento, precio) VALUES (v_res, v_p1, v_v4, v_clase, '2A', 50);
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Billete en vuelo cancelado', 'error', IF(v_err, 'error', 'ok'));

    -- ============ TRIPULACION (V1 de 10:00 a 12:00 -> empleado ocupado 09:00 a 12:45) ============
    SET v_err = 0;
    INSERT INTO tripulacion_vuelo (id_vuelo, id_empleado, funcion) VALUES (v_v1, v_emp, 'comandante');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Tripulacion: primera asignacion', 'ok', IF(v_err, 'error', 'ok'));

    SET v_err = 0;
    INSERT INTO tripulacion_vuelo (id_vuelo, id_empleado, funcion) VALUES (v_v3, v_emp, 'comandante');   -- V3 sale 11:00
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Tripulacion: vuelo solapado', 'error', IF(v_err, 'error', 'ok'));

    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
        VALUES ('TS012', v_ruta, v_ac2, '2030-01-01 13:44', '2030-01-01 14:30');          -- se presenta 12:44 < 12:45
    SET v_v12 = LAST_INSERT_ID();
    SET v_err = 0;
    INSERT INTO tripulacion_vuelo (id_vuelo, id_empleado, funcion) VALUES (v_v12, v_emp, 'comandante');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Tripulacion: 1 min menos de descanso', 'error', IF(v_err, 'error', 'ok'));

    INSERT INTO vuelo (numero_vuelo, id_ruta, id_aeronave, salida_prevista, llegada_prevista)
        VALUES ('TS013', v_ruta, v_ac3, '2030-01-01 13:45', '2030-01-01 14:45');          -- se presenta 12:45 = fin de ocupacion
    SET v_v11 = LAST_INSERT_ID();
    SET v_err = 0;
    INSERT INTO tripulacion_vuelo (id_vuelo, id_empleado, funcion) VALUES (v_v11, v_emp, 'comandante');
    INSERT INTO test_resultado (caso, esperado, obtenido) VALUES ('Tripulacion: descanso justo en el limite', 'ok', IF(v_err, 'error', 'ok'));

    ROLLBACK;

    SELECT n, caso, esperado, obtenido, IF(esperado = obtenido, 'OK', 'FALLO') AS resultado FROM test_resultado ORDER BY n;
    DROP TEMPORARY TABLE test_resultado;
END$$

DELIMITER ;

CALL sp_test_triggers();

-- =====================================================================
-- 01_triggers_vuelo.sql  --  Bloque 4 (SQL avanzado), filas 25-27 del plan
--
-- MySQL no tiene EXCLUDE (PostgreSQL), asi que los solapes se controlan con
-- triggers BEFORE INSERT / BEFORE UPDATE sobre vuelo. Para no duplicar codigo
-- (un trigger de INSERT y otro de UPDATE), la logica vive en procedimientos
-- sp_validar_* que ambos llaman.
--
-- Reglas (coinciden con generar_puertas_sinteticas.py y verificar_aeropuerto.sql):
--   PUERTA   ocupada de [salida_prevista - 45 min] a [max(salida prevista, real) + 10 min]
--            y debe ser del aeropuerto de ORIGEN de la ruta.
--   PISTA    dos salidas por la misma pista deben separarse >= 2 min (separacion
--            minima simplificada). Debe ser del aeropuerto de origen.
--   AERONAVE no puede estar en dos vuelos a la vez (horas PREVISTAS, tocarse no
--            es solapar) ni volar durante una orden de mantenimiento.
--   Un vuelo 'cancelado' no ocupa nada y no se valida.
--
-- Limitaciones (para el README): vuelo.id_pista es solo la pista de salida
-- (no se modelan aterrizajes); las horas REALES del BTS pueden solapar aeronaves
-- (~820 casos ya cargados): el trigger controla datos NUEVOS, no revisa los viejos.
--
-- ORDEN: ejecutar DESPUES de cargar los datos (importacion.py). Antes de recargar
-- con --reiniciar, ejecutar 00_quitar_triggers.sql (LOAD DATA dispara triggers).
-- =====================================================================
USE aeropuerto;

DROP TRIGGER IF EXISTS trg_vuelo_bi;
DROP TRIGGER IF EXISTS trg_vuelo_bu;
DROP PROCEDURE IF EXISTS sp_validar_puerta;
DROP PROCEDURE IF EXISTS sp_validar_pista;
DROP PROCEDURE IF EXISTS sp_validar_aeronave;

DELIMITER $$

CREATE PROCEDURE sp_validar_puerta(
    IN p_id_vuelo INT, IN p_id_ruta INT, IN p_id_puerta INT,
    IN p_salida_prevista DATETIME, IN p_salida_real DATETIME)
BEGIN
    DECLARE v_ini DATETIME;
    DECLARE v_fin DATETIME;
    DECLARE v_aero_puerta INT DEFAULT NULL;
    DECLARE v_aero_origen INT DEFAULT NULL;
    DECLARE v_otro VARCHAR(10) DEFAULT NULL;
    DECLARE v_msg VARCHAR(120);

    IF p_id_puerta IS NOT NULL THEN
        SELECT t.id_aeropuerto INTO v_aero_puerta
          FROM puerta_embarque p JOIN terminal t ON t.id_terminal = p.id_terminal
         WHERE p.id_puerta = p_id_puerta;
        SELECT id_aeropuerto_origen INTO v_aero_origen FROM ruta WHERE id_ruta = p_id_ruta;

        IF v_aero_puerta <> v_aero_origen THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La puerta no es del aeropuerto de origen del vuelo';
        END IF;

        SET v_ini = p_salida_prevista - INTERVAL 45 MINUTE;
        SET v_fin = GREATEST(p_salida_prevista, COALESCE(p_salida_real, p_salida_prevista)) + INTERVAL 10 MINUTE;

        -- El BETWEEN de +-2 dias permite usar idx_vuelo_puerta_salida (id_puerta, salida_prevista)
        SELECT v.numero_vuelo INTO v_otro
          FROM vuelo v
         WHERE v.id_puerta = p_id_puerta
           AND v.id_vuelo <> COALESCE(p_id_vuelo, 0)
           AND v.estado <> 'cancelado'
           AND v.salida_prevista BETWEEN p_salida_prevista - INTERVAL 2 DAY AND p_salida_prevista + INTERVAL 2 DAY
           AND v.salida_prevista - INTERVAL 45 MINUTE < v_fin
           AND GREATEST(v.salida_prevista, COALESCE(v.salida_real, v.salida_prevista)) + INTERVAL 10 MINUTE > v_ini
         LIMIT 1;

        IF v_otro IS NOT NULL THEN
            SET v_msg = CONCAT('Solape de puerta con el vuelo ', v_otro);
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

CREATE PROCEDURE sp_validar_pista(
    IN p_id_vuelo INT, IN p_id_ruta INT, IN p_id_pista INT, IN p_salida_prevista DATETIME)
BEGIN
    DECLARE v_aero_pista INT DEFAULT NULL;
    DECLARE v_aero_origen INT DEFAULT NULL;
    DECLARE v_otro VARCHAR(10) DEFAULT NULL;
    DECLARE v_msg VARCHAR(120);

    IF p_id_pista IS NOT NULL THEN
        SELECT id_aeropuerto INTO v_aero_pista FROM pista WHERE id_pista = p_id_pista;
        SELECT id_aeropuerto_origen INTO v_aero_origen FROM ruta WHERE id_ruta = p_id_ruta;

        IF v_aero_pista <> v_aero_origen THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La pista no es del aeropuerto de origen del vuelo';
        END IF;

        -- Separacion minima de 2 minutos entre salidas por la misma pista
        SELECT v.numero_vuelo INTO v_otro
          FROM vuelo v
         WHERE v.id_pista = p_id_pista
           AND v.id_vuelo <> COALESCE(p_id_vuelo, 0)
           AND v.estado <> 'cancelado'
           AND v.salida_prevista > p_salida_prevista - INTERVAL 2 MINUTE
           AND v.salida_prevista < p_salida_prevista + INTERVAL 2 MINUTE
         LIMIT 1;

        IF v_otro IS NOT NULL THEN
            SET v_msg = CONCAT('Pista ocupada: salida a menos de 2 min del vuelo ', v_otro);
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

CREATE PROCEDURE sp_validar_aeronave(
    IN p_id_vuelo INT, IN p_id_aeronave INT,
    IN p_salida_prevista DATETIME, IN p_llegada_prevista DATETIME)
BEGIN
    DECLARE v_otro VARCHAR(10) DEFAULT NULL;
    DECLARE v_mant VARCHAR(50) DEFAULT NULL;
    DECLARE v_msg VARCHAR(120);

    -- Dos vuelos se solapan si cada uno sale antes de que llegue el otro.
    -- Cota inferior de 2 dias (ningun vuelo dura tanto) para usar idx_vuelo_aeronave_salida.
    SELECT v.numero_vuelo INTO v_otro
      FROM vuelo v
     WHERE v.id_aeronave = p_id_aeronave
       AND v.id_vuelo <> COALESCE(p_id_vuelo, 0)
       AND v.estado <> 'cancelado'
       AND v.salida_prevista > p_salida_prevista - INTERVAL 2 DAY
       AND v.salida_prevista < p_llegada_prevista
       AND v.llegada_prevista > p_salida_prevista
     LIMIT 1;

    IF v_otro IS NOT NULL THEN
        SET v_msg = CONCAT('La aeronave ya esta en el vuelo ', v_otro, ' a esa hora');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;

    -- Orden de mantenimiento abierta (fecha_fin NULL) = sin fin conocido
    SELECT m.tipo INTO v_mant
      FROM mantenimiento m
     WHERE m.id_aeronave = p_id_aeronave
       AND m.fecha_inicio < p_llegada_prevista
       AND COALESCE(m.fecha_fin, '9999-12-31 23:59:59') > p_salida_prevista
     LIMIT 1;

    IF v_mant IS NOT NULL THEN
        SET v_msg = CONCAT('La aeronave esta en mantenimiento (', v_mant, ') en ese horario');
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END$$

CREATE TRIGGER trg_vuelo_bi BEFORE INSERT ON vuelo FOR EACH ROW
BEGIN
    IF NEW.estado <> 'cancelado' THEN
        CALL sp_validar_puerta(NEW.id_vuelo, NEW.id_ruta, NEW.id_puerta, NEW.salida_prevista, NEW.salida_real);
        CALL sp_validar_pista(NEW.id_vuelo, NEW.id_ruta, NEW.id_pista, NEW.salida_prevista);
        CALL sp_validar_aeronave(NEW.id_vuelo, NEW.id_aeronave, NEW.salida_prevista, NEW.llegada_prevista);
    END IF;
END$$

-- En UPDATE solo se valida lo que cambia: asi un UPDATE inocuo (p. ej. solo el estado)
-- sobre una fila antigua que ya solapaba no falla por culpa de datos heredados.
CREATE TRIGGER trg_vuelo_bu BEFORE UPDATE ON vuelo FOR EACH ROW
BEGIN
    IF NEW.estado <> 'cancelado' THEN
        IF NOT (NEW.id_puerta <=> OLD.id_puerta AND NEW.id_ruta = OLD.id_ruta
                AND NEW.salida_prevista = OLD.salida_prevista
                AND NEW.salida_real <=> OLD.salida_real AND NEW.estado = OLD.estado) THEN
            CALL sp_validar_puerta(NEW.id_vuelo, NEW.id_ruta, NEW.id_puerta, NEW.salida_prevista, NEW.salida_real);
        END IF;
        IF NOT (NEW.id_pista <=> OLD.id_pista AND NEW.id_ruta = OLD.id_ruta
                AND NEW.salida_prevista = OLD.salida_prevista AND NEW.estado = OLD.estado) THEN
            CALL sp_validar_pista(NEW.id_vuelo, NEW.id_ruta, NEW.id_pista, NEW.salida_prevista);
        END IF;
        IF NOT (NEW.id_aeronave = OLD.id_aeronave AND NEW.salida_prevista = OLD.salida_prevista
                AND NEW.llegada_prevista = OLD.llegada_prevista AND NEW.estado = OLD.estado) THEN
            CALL sp_validar_aeronave(NEW.id_vuelo, NEW.id_aeronave, NEW.salida_prevista, NEW.llegada_prevista);
        END IF;
    END IF;
END$$

DELIMITER ;

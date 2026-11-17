-- =====================================================================
-- 03_triggers_tripulacion.sql  --  Bloque 4 (SQL avanzado), fila 29 del plan
-- Descanso minimo de la tripulacion.
--
-- Un empleado "ocupa" un vuelo desde 60 min antes de la salida prevista (presentacion)
-- hasta 45 min despues de la llegada (real si existe, si no prevista). Dos asignaciones
-- del mismo empleado no pueden solaparse (equivale a los 105 min de
-- verificar_aeropuerto.sql, y a los parametros de la celda 16 del notebook).
-- Los vuelos cancelados no cuentan. Tocarse justo en el limite esta permitido.
--
-- ORDEN: despues de cargar los datos (con 1,9 M de filas en tripulacion_vuelo el
-- trigger ralentizaria mucho la carga). Antes de recargar: 00_quitar_triggers.sql
-- =====================================================================
USE aeropuerto;

DROP TRIGGER IF EXISTS trg_tripulacion_bi;
DROP TRIGGER IF EXISTS trg_tripulacion_bu;
DROP PROCEDURE IF EXISTS sp_validar_descanso;

DELIMITER $$

CREATE PROCEDURE sp_validar_descanso(IN p_id_vuelo INT, IN p_id_empleado INT)
BEGIN
    DECLARE v_ini DATETIME DEFAULT NULL;
    DECLARE v_fin DATETIME DEFAULT NULL;
    DECLARE v_estado VARCHAR(20) DEFAULT NULL;
    DECLARE v_otro VARCHAR(10) DEFAULT NULL;
    DECLARE v_msg VARCHAR(120);

    SELECT salida_prevista - INTERVAL 60 MINUTE,
           COALESCE(llegada_real, llegada_prevista) + INTERVAL 45 MINUTE,
           estado
      INTO v_ini, v_fin, v_estado
      FROM vuelo WHERE id_vuelo = p_id_vuelo;

    IF v_estado IS NOT NULL AND v_estado <> 'cancelado' THEN
        -- Se recorren solo los vuelos de ese empleado (indice de la FK id_empleado)
        SELECT v.numero_vuelo INTO v_otro
          FROM tripulacion_vuelo t
          JOIN vuelo v ON v.id_vuelo = t.id_vuelo
         WHERE t.id_empleado = p_id_empleado
           AND t.id_vuelo <> p_id_vuelo
           AND v.estado <> 'cancelado'
           AND v.salida_prevista - INTERVAL 60 MINUTE < v_fin
           AND COALESCE(v.llegada_real, v.llegada_prevista) + INTERVAL 45 MINUTE > v_ini
         LIMIT 1;

        IF v_otro IS NOT NULL THEN
            SET v_msg = CONCAT('Descanso insuficiente: choca con el vuelo ', v_otro);
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_tripulacion_bi BEFORE INSERT ON tripulacion_vuelo FOR EACH ROW
BEGIN
    CALL sp_validar_descanso(NEW.id_vuelo, NEW.id_empleado);
END$$

CREATE TRIGGER trg_tripulacion_bu BEFORE UPDATE ON tripulacion_vuelo FOR EACH ROW
BEGIN
    IF NEW.id_vuelo <> OLD.id_vuelo OR NEW.id_empleado <> OLD.id_empleado THEN
        CALL sp_validar_descanso(NEW.id_vuelo, NEW.id_empleado);
    END IF;
END$$

DELIMITER ;

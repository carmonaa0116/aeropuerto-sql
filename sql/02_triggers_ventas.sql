-- =====================================================================
-- 02_triggers_ventas.sql  --  Bloque 4 (SQL avanzado), fila 28 del plan
-- Overbooking y asiento duplicado en billete.
--
--   ASIENTO DUPLICADO: ya lo cubre UNIQUE (id_vuelo, asiento) del esquema (error 1062).
--       Un billete cancelado conservaba su asiento y bloqueaba la reventa, asi que al
--       cancelar el trigger pone asiento = NULL (UNIQUE admite varios NULL).
--   OVERBOOKING: billetes no cancelados >= capacidad_total del modelo -> error.
--       Se bloquea la fila del vuelo (FOR UPDATE) para que dos ventas simultaneas del
--       ultimo asiento se serialicen y no pasen las dos.
--   Tampoco se venden billetes de un vuelo cancelado.
--
-- Nota: por el FOR UPDATE, un INSERT INTO billete ... SELECT ... FROM vuelo puede dar
-- el error 1442 (el trigger bloquea la misma tabla que lee la sentencia). Inserta con
-- VALUES / LOAD DATA, o resuelve antes los ids (probado: asi funciona).
--
-- ORDEN: despues de cargar los datos. Antes de recargar: 00_quitar_triggers.sql
-- =====================================================================
USE aeropuerto;

DROP TRIGGER IF EXISTS trg_billete_bi;
DROP TRIGGER IF EXISTS trg_billete_bu;
DROP PROCEDURE IF EXISTS sp_validar_billete;

DELIMITER $$

CREATE PROCEDURE sp_validar_billete(IN p_id_billete INT, IN p_id_vuelo INT)
BEGIN
    DECLARE v_estado_vuelo VARCHAR(20) DEFAULT NULL;
    DECLARE v_id_aeronave INT DEFAULT NULL;
    DECLARE v_capacidad INT DEFAULT NULL;
    DECLARE v_vendidos INT DEFAULT 0;

    -- Solo se bloquea la fila de vuelo (no la de modelo_aeronave, compartida por miles de vuelos)
    SELECT estado, id_aeronave INTO v_estado_vuelo, v_id_aeronave
      FROM vuelo WHERE id_vuelo = p_id_vuelo FOR UPDATE;

    IF v_estado_vuelo = 'cancelado' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'No se pueden vender billetes de un vuelo cancelado';
    END IF;

    SELECT m.capacidad_total INTO v_capacidad
      FROM aeronave a JOIN modelo_aeronave m ON m.id_modelo = a.id_modelo
     WHERE a.id_aeronave = v_id_aeronave;

    SELECT COUNT(*) INTO v_vendidos
      FROM billete
     WHERE id_vuelo = p_id_vuelo AND estado <> 'cancelado' AND id_billete <> COALESCE(p_id_billete, 0);

    IF v_vendidos >= v_capacidad THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Overbooking: el vuelo no tiene plazas libres';
    END IF;
END$$

CREATE TRIGGER trg_billete_bi BEFORE INSERT ON billete FOR EACH ROW
BEGIN
    IF NEW.estado <> 'cancelado' THEN
        CALL sp_validar_billete(NEW.id_billete, NEW.id_vuelo);
    END IF;
END$$

CREATE TRIGGER trg_billete_bu BEFORE UPDATE ON billete FOR EACH ROW
BEGIN
    IF NEW.estado = 'cancelado' AND OLD.estado <> 'cancelado' THEN
        SET NEW.asiento = NULL;                       -- libera el asiento
    ELSEIF NEW.estado <> 'cancelado' AND (OLD.estado = 'cancelado' OR NEW.id_vuelo <> OLD.id_vuelo) THEN
        CALL sp_validar_billete(NEW.id_billete, NEW.id_vuelo);   -- reactivar o cambiar de vuelo ocupa plaza
    END IF;
END$$

DELIMITER ;

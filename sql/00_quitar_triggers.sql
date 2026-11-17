-- =====================================================================
-- 00_quitar_triggers.sql
-- Ejecutar ANTES de recargar datos con importacion.py --reiniciar:
-- TRUNCATE no dispara triggers, pero LOAD DATA si (lento y puede rechazar filas).
-- Despues de la carga, volver a ejecutar 01, 02 y 03.
-- =====================================================================
USE aeropuerto;

DROP TRIGGER IF EXISTS trg_vuelo_bi;
DROP TRIGGER IF EXISTS trg_vuelo_bu;
DROP TRIGGER IF EXISTS trg_billete_bi;
DROP TRIGGER IF EXISTS trg_billete_bu;
DROP TRIGGER IF EXISTS trg_tripulacion_bi;
DROP TRIGGER IF EXISTS trg_tripulacion_bu;

DROP PROCEDURE IF EXISTS sp_validar_puerta;
DROP PROCEDURE IF EXISTS sp_validar_pista;
DROP PROCEDURE IF EXISTS sp_validar_aeronave;
DROP PROCEDURE IF EXISTS sp_validar_billete;
DROP PROCEDURE IF EXISTS sp_validar_descanso;

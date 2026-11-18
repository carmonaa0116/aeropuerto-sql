-- =====================================================================
-- app/backend/sql/00_usuarios_app.sql
-- Usuarios MySQL de la app web, con permisos mínimos.
--
--   app_ro  solo SELECT sobre aeropuerto y aeropuerto_verif
--           (consultas Q01-Q10, explorador, modelo ER, calidad, rendimiento)
--   app_rw  SELECT en aeropuerto + INSERT/UPDATE/DELETE solo en las tablas
--           del CRUD (vuelo, empleado, pasajero, aeronave) y del asistente
--           de vuelos (tripulacion_vuelo). El EXECUTE de sp_demo_trigger se
--           concede en 01_demo_triggers.sql (fase 3), cuando el procedimiento exista.
--
-- Los triggers y sus procedimientos sp_validar_* se ejecutan con los permisos
-- de quien los creó (root), así que app_rw no necesita permisos extra para que
-- los triggers lean mantenimiento, ruta, puerta_embarque, etc.
--
-- CÓMO EJECUTARLO (Workbench, conectado como root):
--   1. File > Open SQL Script... y abre este archivo.
--   2. En la pestaña, sustituye CAMBIA_CLAVE_RO y CAMBIA_CLAVE_RW por dos
--      claves tuyas (mínimo 8 caracteres con mayúscula, minúscula, número y
--      símbolo, por si tienes activado validate_password).
--   3. Ejecuta todo con Ctrl+Shift+Enter.
--   4. Cierra la pestaña SIN GUARDAR (que las claves no queden en el archivo
--      ni en GitHub) y copia las mismas claves en app/backend/.env.
--
-- Host '127.0.0.1': la app se conecta por TCP a 127.0.0.1 (DB_HOST del .env).
-- Se puede volver a ejecutar: CREATE USER IF NOT EXISTS + ALTER USER.
-- =====================================================================

CREATE USER IF NOT EXISTS 'app_ro'@'127.0.0.1' IDENTIFIED BY 'CAMBIA_CLAVE_RO';
CREATE USER IF NOT EXISTS 'app_rw'@'127.0.0.1' IDENTIFIED BY 'CAMBIA_CLAVE_RW';
-- Si ya existían, asegura que la clave es la que acabas de poner
ALTER USER 'app_ro'@'127.0.0.1' IDENTIFIED BY 'CAMBIA_CLAVE_RO';
ALTER USER 'app_rw'@'127.0.0.1' IDENTIFIED BY 'CAMBIA_CLAVE_RW';

-- ---------------- app_ro: solo lectura ----------------
GRANT SELECT ON aeropuerto.*       TO 'app_ro'@'127.0.0.1';
GRANT SELECT ON aeropuerto_verif.* TO 'app_ro'@'127.0.0.1';

-- ---------------- app_rw: escritura mínima ----------------
GRANT SELECT ON aeropuerto.* TO 'app_rw'@'127.0.0.1';
GRANT INSERT, UPDATE, DELETE ON aeropuerto.vuelo             TO 'app_rw'@'127.0.0.1';
GRANT INSERT, UPDATE, DELETE ON aeropuerto.empleado          TO 'app_rw'@'127.0.0.1';
GRANT INSERT, UPDATE, DELETE ON aeropuerto.pasajero          TO 'app_rw'@'127.0.0.1';
GRANT INSERT, UPDATE, DELETE ON aeropuerto.aeronave          TO 'app_rw'@'127.0.0.1';
GRANT INSERT, UPDATE, DELETE ON aeropuerto.tripulacion_vuelo TO 'app_rw'@'127.0.0.1';

-- ---------------- comprobación ----------------
SHOW GRANTS FOR 'app_ro'@'127.0.0.1';
SHOW GRANTS FOR 'app_rw'@'127.0.0.1';

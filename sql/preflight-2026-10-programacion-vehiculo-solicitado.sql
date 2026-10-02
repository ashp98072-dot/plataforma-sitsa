-- PROGRAMACION-VEHICULO-SOLICITADO — PREFLIGHT. SOLO LECTURA (no modifica nada).
-- Seleccionar explícitamente la BD del tenant antes de ejecutar. Compatible con phpMyAdmin.
--
-- APLICAR si:
--   - tms_planes_viaje y tms_cotizacion_costeo_perfiles existen, ambas InnoDB;
--   - tms_planes_viaje.empresa_id y tms_cotizacion_costeo_perfiles.(empresa_id, id) son INT signed;
--   - tms_cotizacion_costeo_perfiles tiene el UNIQUE (empresa_id, id) = uq_costeo_perfil_empresa_id;
--   - tms_planes_viaje tiene la columna tc_externo_placa (se usa en AFTER);
--   - las columnas vehiculo_solicitado_* NO existen, o existen exactamente como en la migración
--     (INT NULL / VARCHAR(120) NULL) => la migración es NOOP en esa parte;
--   - el nombre fk_tmsplan_vehiculo_solicitado no pertenece a otra tabla.
-- DETENER ante cualquier diferencia (tipos, columnas parciales, FK con otro destino). No convertir tipos.
SELECT VERSION(), DATABASE();
SHOW VARIABLES LIKE 'foreign_key_checks';
SHOW TABLE STATUS WHERE Name IN ('tms_planes_viaje', 'tms_cotizacion_costeo_perfiles');
SHOW CREATE TABLE tms_planes_viaje;
SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;
SHOW INDEX FROM tms_cotizacion_costeo_perfiles;
SHOW COLUMNS FROM tms_planes_viaje LIKE 'tc_externo_placa';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'vehiculo_solicitado%';
SHOW INDEX FROM tms_planes_viaje WHERE Key_name = 'idx_tmsplan_vehiculo_solicitado';
-- Perfiles disponibles por empresa (el selector solo ofrece los activos de la empresa del usuario).
SELECT empresa_id, id, codigo, nombre, activo FROM tms_cotizacion_costeo_perfiles ORDER BY empresa_id, nombre;

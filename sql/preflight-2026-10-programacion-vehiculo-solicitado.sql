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
--   - la FK fk_tmsplan_vehiculo_solicitado (consulta 9):
--       0 filas                                   => la migración la crea;
--       1 fila en tms_planes_viaje -> tms_cotizacion_costeo_perfiles, columnas
--         (empresa_id, vehiculo_solicitado_perfil_id) -> (empresa_id, id),
--         DELETE_RULE = RESTRICT y UPDATE_RULE = RESTRICT  => ya aplicada (la migración la omite);
--       cualquier otra cosa (otra tabla con ese nombre, otras columnas/reglas) => DETENER.
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
-- 9) ¿Existe ya la FK? (mismo criterio que usa la migración para decidir si la crea).
SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, rc.REFERENCED_TABLE_NAME, rc.DELETE_RULE, rc.UPDATE_RULE
FROM information_schema.TABLE_CONSTRAINTS tc
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.CONSTRAINT_NAME = 'fk_tmsplan_vehiculo_solicitado'
  AND tc.CONSTRAINT_TYPE = 'FOREIGN KEY';
SELECT TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'fk_tmsplan_vehiculo_solicitado'
ORDER BY ORDINAL_POSITION;
-- Perfiles disponibles por empresa (el selector solo ofrece los activos de la empresa del usuario).
SELECT empresa_id, id, codigo, nombre, activo FROM tms_cotizacion_costeo_perfiles ORDER BY empresa_id, nombre;

-- Solo lectura. Revisar grants del usuario que ejecutara el DDL (no del usuario web).
SELECT VERSION() AS version_mariadb, DATABASE() AS esquema, CURRENT_USER() AS ejecutor;
SHOW GRANTS FOR CURRENT_USER;
-- Requiere CREATE, REFERENCES, TRIGGER, CREATE ROUTINE, ALTER ROUTINE y EXECUTE;
-- SELECT para los cursores y tablas referenciadas. No ejecutar con --force.
SELECT TABLE_NAME FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones';
SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA=DATABASE() AND (TRIGGER_NAME LIKE 'ffi\_%' OR TRIGGER_NAME LIKE 'ffu\_%' OR TRIGGER_NAME LIKE 'flota\_fusion\_%');
SELECT ROUTINE_NAME FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME='instalar_guardas_fusion';
-- Las tres consultas anteriores deben estar vacias en primera instalacion.
-- Inventario real; todas las tablas deben ser InnoDB.
SELECT DISTINCT c.TABLE_NAME,c.COLUMN_NAME,t.ENGINE,
 CONCAT('ffi_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)) AS guarda_insert,
 CONCAT('ffu_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)) AS guarda_update
 FROM information_schema.COLUMNS c
 JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
 WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE'
 AND c.TABLE_NAME NOT IN ('flota_vehiculos','flota_vehiculos_fusiones')
 AND (c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' OR c.COLUMN_NAME IN ('vehiculo_id','unidad_recurrente_id') OR EXISTS(
 SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos' AND k.REFERENCED_COLUMN_NAME='id'))
 ORDER BY c.TABLE_NAME,c.COLUMN_NAME;

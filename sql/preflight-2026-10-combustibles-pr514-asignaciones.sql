-- SOLO PREPARADO. No ejecutado. Revisar todos los resultados ANTES de aprobar DDL.
SELECT CASE WHEN
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_consumos','empleados','auditoria') AND ENGINE='InnoDB')=3
 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('empleado_id','producto_clasificado','revision_asignacion'))=0
 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_asignaciones')=0
 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_consumos','empleados') AND COLUMN_NAME='id' AND DATA_TYPE='int' AND COLUMN_TYPE NOT LIKE '%unsigned%')=2
 AND (SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND INDEX_NAME='uq_cb2c_ambito' AND NON_UNIQUE=0)='empresa_id,proveedor_id,id'
 AND @@foreign_key_checks=1 AND @@check_constraint_checks=1
 THEN 'REVISAR_Y_APROBAR_MANUALMENTE' ELSE 'ABORTAR_INCOMPATIBLE_O_PARCIAL' END AS precheck_estado;
SHOW CREATE TABLE flota_cb2_consumos;
SHOW CREATE TABLE empleados;
SELECT COUNT(*) AS consumos_antes,MIN(id) AS primer_id,MAX(id) AS ultimo_id FROM flota_cb2_consumos;
-- Guardar los resultados con el backup. Un resultado favorable NO ejecuta ni autoriza la migración.

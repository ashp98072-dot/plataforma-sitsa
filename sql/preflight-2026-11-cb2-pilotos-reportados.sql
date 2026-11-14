-- SOLO SELECT; no ejecutar la migracion si hay faltantes, tipos incompatibles u objetos parciales.
SELECT VERSION(),@@foreign_key_checks,@@check_constraint_checks;
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('empresas','usuarios','flota_cb2_consumos','flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias');
-- Debe devolver cero filas antes de instalar: cualquier tabla nueva existente requiere auditoria de instalacion parcial.
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias');
WITH requeridas AS (
 SELECT 'empresas' tabla,'id' columna UNION ALL SELECT 'usuarios','id' UNION ALL SELECT 'empleados','id' UNION ALL SELECT 'empleados','empresa_id'
 UNION ALL SELECT 'flota_cb2_consumos','empresa_id' UNION ALL SELECT 'flota_cb2_consumos','proveedor_id'
 UNION ALL SELECT 'flota_cb2_consumos','id'
) SELECT r.*,c.COLUMN_TYPE,c.IS_NULLABLE,t.ENGINE FROM requeridas r
 LEFT JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.tabla AND c.COLUMN_NAME=r.columna
 LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
 WHERE c.COLUMN_NAME IS NULL OR c.DATA_TYPE<>'int' OR c.COLUMN_TYPE LIKE '%unsigned%' OR c.IS_NULLABLE<>'NO' OR t.ENGINE<>'InnoDB';
-- Inspeccionar PRIMARY(id) de empresas/usuarios y UNIQUE completo empresa_id,proveedor_id,id de consumos.
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME IN ('empresas','usuarios','empleados') AND INDEX_NAME='PRIMARY')
 OR (TABLE_NAME='flota_cb2_consumos' AND INDEX_NAME='uq_cb2c_ambito')) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;

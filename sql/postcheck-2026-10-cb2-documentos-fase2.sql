-- SOLO LECTURA. PENDIENTE DE AUDITORIA. NO EJECUTADO.
SELECT DATABASE() AS esquema_objetivo,VERSION() AS motor,@@foreign_key_checks AS fk,@@check_constraint_checks AS checks_activos,
 @@sql_mode AS sql_mode,@@innodb_strict_mode AS innodb_estricto;
SHOW CREATE TABLE flota_cb2_facturas;
SHOW CREATE TABLE flota_cb2_documento_operaciones;
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLLATION_NAME
 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
 AND ((TABLE_NAME='flota_cb2_facturas' AND COLUMN_NAME='revision_documental') OR TABLE_NAME='flota_cb2_documento_operaciones');
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_documento_operaciones'
 GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE;
SELECT k.CONSTRAINT_NAME,GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS origen,
 MAX(k.REFERENCED_TABLE_NAME) AS tabla_destino,GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) AS destino,
 MAX(r.UPDATE_RULE) AS regla_actualizar,MAX(r.DELETE_RULE) AS regla_eliminar
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
 WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='flota_cb2_documento_operaciones' GROUP BY k.CONSTRAINT_NAME;
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_facturas','flota_cb2_documento_operaciones');
SELECT COUNT(*) AS revisiones_invalidas FROM flota_cb2_facturas WHERE revision_documental<0;
SELECT COUNT(*) AS operaciones_huerfanas FROM flota_cb2_documento_operaciones o LEFT JOIN flota_cb2_facturas f
 ON f.empresa_id=o.empresa_id AND f.proveedor_id=o.proveedor_id AND f.id=o.factura_id WHERE f.id IS NULL;
-- Antes de activar: tabla nueva vacía, revisiones cero, 0 huérfanos.
-- Contrastar SHOW CREATE con el DDL aprobado (tipos/índices/FK/CHECK completos),
-- NO interpretar la mera presencia de dos objetos como certificación suficiente.
SELECT (SELECT COUNT(*) FROM flota_cb2_documento_operaciones) AS operaciones,
 MIN(revision_documental) AS revision_minima,MAX(revision_documental) AS revision_maxima FROM flota_cb2_facturas;

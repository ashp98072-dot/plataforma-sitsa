-- SOLO LECTURA. NO EJECUTADO. PARADA OBLIGATORIA DESPUES DEL ALTER TABLE.
-- Comprobar incluso tras error/timeout: no deducir el estado del mensaje web.
-- NO continuar a paso 2 solo porque haya una columna: revisar TODO el resultado.
SELECT DATABASE() AS esquema_objetivo,VERSION() AS motor,
 @@foreign_key_checks AS fk,@@check_constraint_checks AS checks_activos,
 @@sql_mode AS sql_mode,@@innodb_strict_mode AS innodb_estricto;
SHOW CREATE TABLE flota_cb2_facturas;
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_facturas' AND COLUMN_NAME='revision_documental';
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_facturas' AND CONSTRAINT_NAME='ck_cb2f_revision_documental';
SELECT COUNT(*) AS revisiones_no_iniciales FROM flota_cb2_facturas WHERE revision_documental<>0;
SELECT COUNT(*) AS tabla_operaciones_existente FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_documento_operaciones';
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_cb2_facturas','compras_proveedores','usuarios','auditoria');
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='flota_cb2_facturas' AND COLUMN_NAME IN ('id','empresa_id','proveedor_id'))
 OR (TABLE_NAME='usuarios' AND COLUMN_NAME='id'));
SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_facturas'
 GROUP BY INDEX_NAME,NON_UNIQUE;
-- En MariaDB 11.8, los nombres FK deben ser únicos en el esquema.
SELECT TABLE_NAME,CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('fk_cb2do_factura','fk_cb2do_usuario');
-- Esperado: misma base aprobada, MariaDB 11.8, strict/innodb/fk/check activos;
-- revision INT signed NOT NULL DEFAULT 0 y CHECK revision_documental>=0;
-- 0 revisiones no iniciales; tabla operaciones ausente; 4 bases InnoDB;
-- IDs INT signed compatibles; UNIQUE (empresa_id,proveedor_id,id);
-- sin colisiones de FK. Flag sigue apagado en TODOS los nodos (verificación externa).
-- Cualquier divergencia: PARAR y auditar reparación específica; no ejecutar paso 2.

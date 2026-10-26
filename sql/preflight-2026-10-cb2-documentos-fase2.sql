-- SOLO LECTURA. PENDIENTE DE AUDITORIA. NO EJECUTADO.
-- Elegir explícitamente la base objetivo en la herramienta administrativa.
-- No autoriza ni ejecuta DDL; validar manualmente TODO antes de autorizarlo.
-- PARADA OBLIGATORIA: no enviar este archivo junto con ningún DDL.
SELECT DATABASE() AS esquema_objetivo, VERSION() AS motor,
 @@foreign_key_checks AS fk, @@check_constraint_checks AS checks_activos,
 @@sql_mode AS sql_mode, @@innodb_strict_mode AS innodb_estricto;
SELECT TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
 ('flota_cb2_facturas','compras_proveedores','usuarios','auditoria','flota_cb2_documento_operaciones');
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND
 ((TABLE_NAME='flota_cb2_facturas' AND COLUMN_NAME IN ('id','empresa_id','proveedor_id','fecha_factura','total_documental','moneda','revision_documental'))
 OR (TABLE_NAME='usuarios' AND COLUMN_NAME='id') OR TABLE_NAME='auditoria' OR TABLE_NAME='flota_cb2_documento_operaciones');
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_cb2_facturas','flota_cb2_documento_operaciones') GROUP BY TABLE_NAME,INDEX_NAME,NON_UNIQUE;
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_facturas','flota_cb2_documento_operaciones');
SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_STATEMENT FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('flota_cb2_facturas','auditoria','flota_cb2_documento_operaciones');
-- Esperado: MariaDB 11.8, InnoDB; IDs INT signed compatibles; total DECIMAL(18,6).
-- UNIQUE existente (empresa_id,proveedor_id,id) en facturas; auditoria.detalle TEXT.
-- Estado inicial: NO revision_documental NI tabla operaciones. Si existe solo
-- una parte: DETENERSE, no repetir migración. Si están ambas: usar postcheck.
SELECT COUNT(*) AS facturas_con_total_invalido FROM flota_cb2_facturas WHERE total_documental<0;
SELECT TABLE_NAME,CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME IN ('ck_cb2f_revision_documental','fk_cb2do_factura','fk_cb2do_usuario');
-- En estado inicial limpio esta última consulta no devuelve filas. MariaDB 11.8
-- requiere nombres FK únicos en el esquema. No omitir colisiones detectadas.
-- Revisar base elegida, motor 11.8, strict/innodb/fk/check activos, tipos/índices,
-- auditoria InnoDB, triggers y backup; aprobar antes de abrir el paso 1 por separado.

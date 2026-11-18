-- Solo lectura. Revisar motor, tipos e índices antes de aplicar la migración.
SELECT VERSION() AS version_mariadb, DATABASE() AS base_actual;
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('empresas','usuarios','empleados','compras_proveedores','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos') ORDER BY TABLE_NAME;
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME IN ('empresas','usuarios') AND COLUMN_NAME='id') OR (TABLE_NAME IN ('empleados','compras_proveedores') AND COLUMN_NAME IN ('empresa_id','id'))) ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('empresas','usuarios','empleados','compras_proveedores') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
-- DETENER si faltan tablas, no son InnoDB, las columnas no son INT firmado,
-- faltan índices únicos (empresa_id,id), o ya existe alguna tabla canecas_*.

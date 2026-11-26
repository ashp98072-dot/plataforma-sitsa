-- Solo lectura. Seleccionar explícitamente la base correcta en phpMyAdmin.
SELECT DATABASE() AS esquema_actual, VERSION() AS version_servidor;
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('empresas','usuarios','compras_proveedores','flota_vehiculos','flota_cb2_placas_equivalencias') ORDER BY TABLE_NAME;
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME IN ('empresas','usuarios','flota_vehiculos') AND COLUMN_NAME='id') OR (TABLE_NAME='compras_proveedores' AND COLUMN_NAME IN ('empresa_id','id'))) ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT INDEX_NAME,NON_UNIQUE,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='compras_proveedores' GROUP BY INDEX_NAME,NON_UNIQUE;

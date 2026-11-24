-- Solo lectura. Un resultado vacío no prueba ausencia si la cuenta no tiene visibilidad.
-- Úsese tras un error de ejecutar-ventas-controlado.mjs; no reintentar sin este diagnóstico ni sin respaldo restaurable.
SELECT DATABASE() AS base, VERSION() AS version;
-- 1) Objetos de la migración presentes (esperado al terminar: 2 tablas y 4 triggers).
SELECT 'tablas' AS objeto, TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_compras_mapeo_proveedor')
UNION ALL SELECT 'triggers', TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('trg_can_venta_bu','trg_can_venta_bd','trg_can_mapeo_bu','trg_can_mapeo_bd');
-- 2) Estructura de las tablas nuevas.
SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_compras_mapeo_proveedor') ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_compras_mapeo_proveedor') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
SELECT TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_ventas','canecas_compras_mapeo_proveedor') AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;
SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('canecas_ventas','canecas_compras_mapeo_proveedor') ORDER BY TRIGGER_NAME;
-- 3) Solo si las tablas existen: recuentos (una instalación parcial no debe tener filas) y coherencia ingreso/costo.
-- SELECT COUNT(*) AS ventas, SUM(estado='ANULADA') AS anuladas FROM canecas_ventas;
-- SELECT COUNT(*) AS mapeos FROM canecas_compras_mapeo_proveedor;

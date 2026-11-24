-- Solo lectura. Un resultado vacío no prueba ausencia si la cuenta no tiene visibilidad.
-- Úsese tras un error de ejecutar-catalogos-controlado.mjs; no reintentar sin este diagnóstico ni sin respaldo restaurable.
SELECT DATABASE() AS base, VERSION() AS version;
-- 1) Objetos de la migración presentes (esperado al terminar: 2 tablas, 1 columna y 1 CHECK).
SELECT 'tablas' AS objeto, TABLE_NAME AS nombre FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_proveedores','canecas_clientes')
UNION ALL SELECT 'columna de compras', COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME='canecas_proveedor_id'
UNION ALL SELECT 'check', CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='chk_can_compra_proveedor';
-- 2) Estado de canecas_compras.proveedor_id (antes: int(11) NOT NULL; después: int(11) NULL) y su clave foránea histórica.
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND COLUMN_NAME IN ('proveedor_id','canecas_proveedor_id') ORDER BY COLUMN_NAME;
SELECT CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_compras' AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME,ORDINAL_POSITION;
-- 3) Estructura de los catálogos nuevos.
SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_proveedores','canecas_clientes') ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_proveedores','canecas_clientes') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
-- 4) Recuento de compras (no debe cambiar con la instalación).
SELECT COUNT(*) AS compras_totales FROM canecas_compras;

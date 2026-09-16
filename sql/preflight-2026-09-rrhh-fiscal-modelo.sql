-- PROPUESTA DE VERIFICACIÓN, NO EJECUTADA POR ESTA RAMA/PR.
-- Solo lectura. Migración de modelo sobre producción: NO-OP, tablas ya existentes.
-- No ejecutar schema.sql en producción ni recrear/convertir tablas.
SELECT VERSION() AS version_servidor;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('empresas', 'empleados', 'documentos_empleados', 'auditoria',
    'rrhh_fiscal_empleado_ejercicio', 'rrhh_fiscal_liquidaciones');
SHOW CREATE TABLE rrhh_fiscal_empleado_ejercicio;
SHOW CREATE TABLE rrhh_fiscal_liquidaciones;
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE empleados;
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('empresas', 'empleados', 'rrhh_fiscal_empleado_ejercicio', 'rrhh_fiscal_liquidaciones')
  AND COLUMN_NAME IN ('id', 'empresa_id', 'id_empleado', 'datos', 'snapshot');
SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('empleados', 'rrhh_fiscal_empleado_ejercicio', 'rrhh_fiscal_liquidaciones')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('rrhh_fiscal_empleado_ejercicio', 'rrhh_fiscal_liquidaciones')
  AND REFERENCED_TABLE_NAME IS NOT NULL;
SELECT 'antecedentes' AS origen, COUNT(*) AS huerfanos_o_tenant_incompatible
FROM rrhh_fiscal_empleado_ejercicio f
LEFT JOIN empresas e ON e.id = f.empresa_id
LEFT JOIN empleados p ON p.id = f.id_empleado AND p.empresa_id = f.empresa_id
WHERE e.id IS NULL OR p.id IS NULL
UNION ALL
SELECT 'liquidaciones', COUNT(*)
FROM rrhh_fiscal_liquidaciones f
LEFT JOIN empresas e ON e.id = f.empresa_id
LEFT JOIN empleados p ON p.id = f.id_empleado AND p.empresa_id = f.empresa_id
WHERE e.id IS NULL OR p.id IS NULL;

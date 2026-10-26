-- SOLO LECTURA. No ejecutar automáticamente. Revisar resultados antes del DDL.
SELECT VERSION(), DATABASE(), @@foreign_key_checks, @@check_constraint_checks;
SHOW CREATE TABLE flota_vehiculos;
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE auditoria;
SELECT COLUMN_NAME, COLUMN_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_vehiculos'
AND COLUMN_NAME IN ('tipo_propiedad','empresa_propietaria_id','propietario_externo','tipo_vehiculo','revision_propiedad');
-- Esperado: cero columnas nuevas; INT firmado en empresas.id, InnoDB en ambas tablas.
SELECT COUNT(*) AS unidades, SUM(e.id IS NULL) AS empresas_huerfanas
FROM flota_vehiculos v LEFT JOIN empresas e ON e.id = v.empresa_id;

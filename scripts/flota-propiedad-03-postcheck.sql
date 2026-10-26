-- SOLO LECTURA. Tras DDL, antes de habilitar la función.
SHOW CREATE TABLE flota_vehiculos;
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_DEFAULT FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'flota_vehiculos'
AND COLUMN_NAME IN ('tipo_propiedad','empresa_propietaria_id','propietario_externo','tipo_vehiculo','revision_propiedad');
SELECT tipo_propiedad, COUNT(*) unidades FROM flota_vehiculos GROUP BY tipo_propiedad;
SELECT COUNT(*) AS invalidos FROM flota_vehiculos
WHERE tipo_propiedad NOT IN ('EMPRESA','EXTERNO') OR revision_propiedad < 0
OR (tipo_propiedad = 'EMPRESA' AND propietario_externo IS NOT NULL)
OR (tipo_propiedad = 'EXTERNO' AND (empresa_propietaria_id IS NOT NULL
  OR propietario_externo IS NULL OR CHAR_LENGTH(TRIM(propietario_externo)) = 0
  OR tipo_vehiculo IS NULL OR CHAR_LENGTH(TRIM(tipo_vehiculo)) = 0));

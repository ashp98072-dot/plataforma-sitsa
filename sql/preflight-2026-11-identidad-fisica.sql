-- SOLO LECTURA. Cualquier diferencia exige detenerse; no ejecutar migraciones con --force.
SELECT VERSION() version, DATABASE() esquema, CURRENT_USER() ejecutor;
SHOW GRANTS;
-- Requeridos: InnoDB en todas, usuarios.id/empresas.id/flota_vehiculos.id INT compatibles.
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('usuarios','empresas','flota_vehiculos','flota_vehiculos_fusiones','flota_cb2_consumos');
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
 AND ((TABLE_NAME='flota_vehiculos' AND COLUMN_NAME IN ('id','empresa_id','tipo_unidad','chasis','activo','estado','en_taller','tipo_propiedad','empresa_propietaria_id','propietario_externo'))
 OR (TABLE_NAME IN ('usuarios','empresas') AND COLUMN_NAME='id')) ORDER BY TABLE_NAME,ORDINAL_POSITION;
-- Debe ser cero antes de una instalacion nueva. Si no: instalacion previa/parcial; auditar, no reejecutar.
SELECT COUNT(*) objetos_preexistentes FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_identidades_fisicas','flota_identidad_miembros','flota_identidad_empresas','flota_identidad_aprobaciones');
-- Debe ser cero antes de agregar ck_cb2_piloto_unico.
SELECT COUNT(*) pilotos_dobles FROM flota_cb2_consumos WHERE empleado_id IS NOT NULL AND piloto_externo_id IS NOT NULL;
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
 AND TABLE_NAME='flota_cb2_consumos' AND CONSTRAINT_NAME IN ('ck_cb2c_unidad_tipo','ck_cb2_piloto_unico');
-- Inventario completo, sin consultar ni mostrar datos privados de los pares reportados.
SELECT TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='flota_vehiculos' ORDER BY TABLE_NAME,COLUMN_NAME;

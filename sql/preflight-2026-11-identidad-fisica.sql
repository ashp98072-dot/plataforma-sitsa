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
-- Contrato EXACTO de sinOperacionesAbiertas: esta consulta debe devolver CERO filas.
-- No se supone que fecha_plan determine si un plan cerrado/cancelado sigue abierto.
SELECT r.tabla,r.campo,'FALTA COLUMNA O MOTOR INCOMPATIBLE' problema FROM (
 SELECT 'flota_viajes' tabla,'id' campo UNION ALL SELECT 'flota_viajes','vehiculo_id'
 UNION ALL SELECT 'flota_viajes','estado' UNION ALL SELECT 'flota_viajes','hora_llegada'
 UNION ALL SELECT 'tms_planes_viaje','id' UNION ALL SELECT 'tms_planes_viaje','tc_vehiculo_id'
 UNION ALL SELECT 'tms_planes_viaje','unidad_id' UNION ALL SELECT 'tms_planes_viaje','estado'
 UNION ALL SELECT 'tms_unidades','id' UNION ALL SELECT 'tms_unidades','flota_vehiculo_id'
) r LEFT JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=r.tabla AND c.COLUMN_NAME=r.campo
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
WHERE c.COLUMN_NAME IS NULL OR COALESCE(t.ENGINE,'')<>'InnoDB';
-- Solo ejecutar lo siguiente si no faltan columnas; muestra tipos, relaciones y vocabulario reales.
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
 AND ((TABLE_NAME='flota_viajes' AND COLUMN_NAME IN ('id','vehiculo_id','estado','hora_llegada'))
 OR (TABLE_NAME='tms_planes_viaje' AND COLUMN_NAME IN ('id','tc_vehiculo_id','unidad_id','estado'))
 OR (TABLE_NAME='tms_unidades' AND COLUMN_NAME IN ('id','flota_vehiculo_id'))) ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='flota_viajes' AND COLUMN_NAME='vehiculo_id')
 OR (TABLE_NAME='tms_planes_viaje' AND COLUMN_NAME IN ('tc_vehiculo_id','unidad_id'))
 OR (TABLE_NAME='tms_unidades' AND COLUMN_NAME='flota_vehiculo_id')) AND REFERENCED_TABLE_NAME IS NOT NULL;
-- flota: cerrado + llegada es terminal. TMS: Cerrado/Cancelado son terminales;
-- Programado/En ruta/Cargado/Descargado y estados desconocidos bloquean conservadoramente.
SELECT estado,COUNT(*) cantidad FROM flota_viajes GROUP BY estado;
SELECT estado,COUNT(*) cantidad FROM tms_planes_viaje GROUP BY estado;

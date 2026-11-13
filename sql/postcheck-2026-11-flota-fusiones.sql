-- Ejecutar con el usuario de instalacion (visibilidad de todos los triggers).
-- APTO estructural exige cero filas en guardas_faltantes, cero motores invalidos,
-- cuatro triggers principales, cero procedimientos pendientes y cero alias inconsistentes.
WITH referencias AS (
 SELECT DISTINCT c.TABLE_NAME,c.COLUMN_NAME,t.ENGINE FROM information_schema.COLUMNS c
 JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME
 WHERE c.TABLE_SCHEMA=DATABASE() AND t.TABLE_TYPE='BASE TABLE' AND c.TABLE_NAME NOT IN ('flota_vehiculos','flota_vehiculos_fusiones')
 AND (c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' OR c.COLUMN_NAME IN ('vehiculo_id','unidad_recurrente_id') OR EXISTS(
 SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos' AND k.REFERENCED_COLUMN_NAME='id'))
), esperadas AS (
 SELECT TABLE_NAME,CONCAT('ffi_',LEFT(SHA2(CONCAT(TABLE_NAME,':',COLUMN_NAME),256),32)) nombre,'INSERT' evento FROM referencias
 UNION ALL
 SELECT TABLE_NAME,CONCAT('ffu_',LEFT(SHA2(CONCAT(TABLE_NAME,':',COLUMN_NAME),256),32)),'UPDATE' FROM referencias
)
SELECT e.* FROM esperadas e LEFT JOIN information_schema.TRIGGERS t
 ON t.TRIGGER_SCHEMA=DATABASE() AND t.TRIGGER_NAME=e.nombre AND t.EVENT_OBJECT_TABLE=e.TABLE_NAME AND t.EVENT_MANIPULATION=e.evento AND t.ACTION_TIMING='BEFORE'
 WHERE t.TRIGGER_NAME IS NULL;
SELECT COUNT(*) AS triggers_principales_deben_ser_4 FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('flota_fusion_identidad','flota_fusion_inmutable','flota_fusion_no_borrar','flota_fusion_no_reactivar');
SELECT COUNT(*) AS procedimientos_pendientes_deben_ser_0 FROM information_schema.ROUTINES
 WHERE ROUTINE_SCHEMA=DATABASE() AND ROUTINE_NAME='instalar_guardas_fusion';
SELECT f.origen_id FROM flota_vehiculos_fusiones f
 JOIN flota_vehiculos o ON o.id=f.origen_id JOIN flota_vehiculos d ON d.id=f.destino_id
 WHERE o.empresa_id<>f.empresa_id OR d.empresa_id<>f.empresa_id OR o.activo<>0 OR o.estado<>'Inactivo'
 OR EXISTS(SELECT 1 FROM flota_vehiculos_fusiones x WHERE x.origen_id=f.destino_id OR x.destino_id=f.origen_id);
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_vehiculos','flota_vehiculos_fusiones') AND ENGINE<>'InnoDB';
-- Preservacion: comparar antes/despues COUNT(*) y CHECKSUM TABLE de las tablas historicas;
-- ninguna fusion reasigna IDs. Las filas de auditoria y el alias son nuevas; vehiculos cambia activo/estado.

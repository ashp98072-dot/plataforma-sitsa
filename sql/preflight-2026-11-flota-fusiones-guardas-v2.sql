-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) de sql/migrate-2026-11-flota-fusiones-guardas-v2.sql — PROPUESTA, no ejecutado en ningún entorno real.
-- Solo SELECT. Opera sobre DATABASE() (seleccionar la base antes). Ejecutar con el usuario de instalación (visibilidad de todos los triggers).
-- Apto para migrar: prerrequisitos = 1 / 1 / (respaldo 0 la primera vez); el resultado 2 lista EXACTAMENTE las guardas que se eliminarán
-- (debe contener solo columnas que NO son un vehículo, p. ej. tms_planes_viaje.vehiculo_solicitado_perfil_id). Cualquier otra fila: DETENER y revisar.
-- =====================================================================

-- 1) Prerrequisitos
SELECT
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_vehiculos_fusiones') AS tabla_fusiones,
 (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME='flota_fusion_identidad') AS trigger_principal,
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo') AS respaldo_ya_existe,
 (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND (TRIGGER_NAME LIKE 'ffi\_%' OR TRIGGER_NAME LIKE 'ffu\_%')) AS guardas_actuales,
 (SELECT COUNT(*) FROM flota_vehiculos_fusiones) AS fusiones_registradas;

-- 2) Guardas que la migración ELIMINARÁ (columnas con nombre de vehículo pero FK a otra tabla y sin FK a flota_vehiculos)
SELECT f.TABLE_NAME AS tabla, f.COLUMN_NAME AS campo, f.REFERENCIA AS fk_hacia, t.TRIGGER_NAME AS guarda, t.EVENT_MANIPULATION AS evento
FROM (
 SELECT DISTINCT c.TABLE_NAME,c.COLUMN_NAME,
  (SELECT MIN(k.REFERENCED_TABLE_NAME) FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME IS NOT NULL) AS REFERENCIA
 FROM information_schema.COLUMNS c
 JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA=c.TABLE_SCHEMA AND tb.TABLE_NAME=c.TABLE_NAME
 WHERE c.TABLE_SCHEMA=DATABASE() AND tb.TABLE_TYPE='BASE TABLE' AND c.TABLE_NAME NOT IN ('flota_vehiculos','flota_vehiculos_fusiones','flota_fusion_guardas_v2_respaldo')
 AND c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' AND c.COLUMN_NAME NOT IN ('vehiculo_id','unidad_recurrente_id')
 AND EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME IS NOT NULL AND k.REFERENCED_TABLE_NAME<>'flota_vehiculos')
 AND NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos')
) f
LEFT JOIN information_schema.TRIGGERS t ON t.TRIGGER_SCHEMA=DATABASE() AND t.EVENT_OBJECT_TABLE=f.TABLE_NAME
 AND t.TRIGGER_NAME IN (CONCAT('ffi_',LEFT(SHA2(CONCAT(f.TABLE_NAME,':',f.COLUMN_NAME),256),32)),CONCAT('ffu_',LEFT(SHA2(CONCAT(f.TABLE_NAME,':',f.COLUMN_NAME),256),32)))
ORDER BY f.TABLE_NAME,f.COLUMN_NAME,t.TRIGGER_NAME;

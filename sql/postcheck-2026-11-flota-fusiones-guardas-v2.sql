-- =====================================================================
-- POSTCHECK (SOLO LECTURA) de sql/migrate-2026-11-flota-fusiones-guardas-v2.sql — PROPUESTA, no ejecutado en ningún entorno real.
-- Solo SELECT. Opera sobre DATABASE(). Con el usuario de instalación.
-- SUSTITUYE al postcheck original (sql/postcheck-2026-11-flota-fusiones.sql) tras aplicar v2: el original cuenta como «guarda faltante»
-- las columnas que v2 deja de proteger a propósito (falsos positivos).
-- APTO estructural: guardas_falso_positivo_restantes = 0 y guardas_faltantes = 0 (ambas consultas devuelven CERO filas);
-- la tabla de respaldo debe tener dos filas (ffi/ffu) por cada guarda eliminada.
-- =====================================================================

-- 1) Guardas de falso positivo que AÚN existen (debe devolver 0 filas)
SELECT t.EVENT_OBJECT_TABLE AS tabla, t.TRIGGER_NAME AS guarda
FROM information_schema.TRIGGERS t
WHERE t.TRIGGER_SCHEMA=DATABASE() AND (t.TRIGGER_NAME LIKE 'ffi\_%' OR t.TRIGGER_NAME LIKE 'ffu\_%')
AND EXISTS(
 SELECT 1 FROM information_schema.COLUMNS c WHERE c.TABLE_SCHEMA=t.TRIGGER_SCHEMA AND c.TABLE_NAME=t.EVENT_OBJECT_TABLE
 AND c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' AND c.COLUMN_NAME NOT IN ('vehiculo_id','unidad_recurrente_id')
 AND t.TRIGGER_NAME IN (CONCAT('ffi_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)),CONCAT('ffu_',LEFT(SHA2(CONCAT(c.TABLE_NAME,':',c.COLUMN_NAME),256),32)))
 AND EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME IS NOT NULL AND k.REFERENCED_TABLE_NAME<>'flota_vehiculos')
 AND NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos')
);

-- 2) Guardas FALTANTES sobre referencias reales a vehículos (debe devolver 0 filas): el conjunto original MENOS los falsos positivos
WITH referencias AS (
 SELECT DISTINCT c.TABLE_NAME,c.COLUMN_NAME FROM information_schema.COLUMNS c
 JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA=c.TABLE_SCHEMA AND tb.TABLE_NAME=c.TABLE_NAME
 WHERE c.TABLE_SCHEMA=DATABASE() AND tb.TABLE_TYPE='BASE TABLE' AND c.TABLE_NAME NOT IN ('flota_vehiculos','flota_vehiculos_fusiones','flota_fusion_guardas_v2_respaldo')
 AND (c.COLUMN_NAME REGEXP '(^|_)vehiculo(_.*)?_id$' OR c.COLUMN_NAME IN ('vehiculo_id','unidad_recurrente_id') OR EXISTS(
  SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos' AND k.REFERENCED_COLUMN_NAME='id'))
 AND NOT (c.COLUMN_NAME NOT IN ('vehiculo_id','unidad_recurrente_id')
  AND EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME IS NOT NULL AND k.REFERENCED_TABLE_NAME<>'flota_vehiculos')
  AND NOT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA=c.TABLE_SCHEMA AND k.TABLE_NAME=c.TABLE_NAME AND k.COLUMN_NAME=c.COLUMN_NAME AND k.REFERENCED_TABLE_SCHEMA=c.TABLE_SCHEMA AND k.REFERENCED_TABLE_NAME='flota_vehiculos'))
), esperadas AS (
 SELECT TABLE_NAME,CONCAT('ffi_',LEFT(SHA2(CONCAT(TABLE_NAME,':',COLUMN_NAME),256),32)) AS nombre,'INSERT' AS evento FROM referencias
 UNION ALL
 SELECT TABLE_NAME,CONCAT('ffu_',LEFT(SHA2(CONCAT(TABLE_NAME,':',COLUMN_NAME),256),32)),'UPDATE' FROM referencias
)
SELECT e.TABLE_NAME AS tabla, e.nombre AS guarda_faltante, e.evento
FROM esperadas e
LEFT JOIN information_schema.TRIGGERS t ON t.TRIGGER_SCHEMA=DATABASE() AND t.EVENT_OBJECT_TABLE=e.TABLE_NAME AND t.TRIGGER_NAME=e.nombre AND t.EVENT_MANIPULATION=e.evento AND t.ACTION_TIMING='BEFORE'
WHERE t.TRIGGER_NAME IS NULL;

-- 3) Respaldo para el rollback (dos filas, ffi y ffu, por cada guarda eliminada)
SELECT tabla, campo, trigger_nombre, evento, creado_en FROM flota_fusion_guardas_v2_respaldo ORDER BY id;

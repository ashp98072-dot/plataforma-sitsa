-- SOLO LECTURA, despues de migrar. FASE 1 no inserta filas: las tres tablas deben estar VACIAS (sin backfill).
SHOW CREATE TABLE tms_liquidacion_config;
SHOW CREATE TABLE tms_viaje_liquidaciones;
SHOW CREATE TABLE tms_viaje_liquidacion_eventos;
SELECT 'tms_liquidacion_config' AS tabla, COUNT(*) AS filas FROM tms_liquidacion_config
UNION ALL SELECT 'tms_viaje_liquidaciones', COUNT(*) FROM tms_viaje_liquidaciones
UNION ALL SELECT 'tms_viaje_liquidacion_eventos', COUNT(*) FROM tms_viaje_liquidacion_eventos;
-- Esperado en este rollout: las tres en 0 (ninguna liquidacion historica, ninguna fecha de activacion).
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
   AND TABLE_NAME IN ('tms_liquidacion_config','tms_viaje_liquidaciones','tms_viaje_liquidacion_eventos') ORDER BY TABLE_NAME, CONSTRAINT_NAME;
-- La asociacion a tabla proviene de TABLE_CONSTRAINTS, nunca de cc.TABLE_NAME (Hostinger).
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
 FROM information_schema.TABLE_CONSTRAINTS tc
 JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME IN ('tms_viaje_liquidaciones','tms_viaje_liquidacion_eventos') AND tc.CONSTRAINT_TYPE='CHECK'
 ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tms_liquidacion_config','tms_viaje_liquidaciones','tms_viaje_liquidacion_eventos');
-- Auditoria de invariantes (cada una debe devolver 0 filas):
-- (a) liquidacion sin su evento de version vigente
SELECT l.id FROM tms_viaje_liquidaciones l LEFT JOIN tms_viaje_liquidacion_eventos e
  ON e.empresa_id=l.empresa_id AND e.plan_id=l.plan_id AND e.version=l.version WHERE e.id IS NULL;
-- (b) hueco en la cadena de versiones (version N sin version N-1)
SELECT e.id FROM tms_viaje_liquidacion_eventos e LEFT JOIN tms_viaje_liquidacion_eventos p
  ON p.empresa_id=e.empresa_id AND p.plan_id=e.plan_id AND p.version=e.version-1 WHERE e.version>1 AND p.id IS NULL;
-- (c) estado vigente distinto del estado_despues del ultimo evento
SELECT l.id FROM tms_viaje_liquidaciones l JOIN tms_viaje_liquidacion_eventos e
  ON e.empresa_id=l.empresa_id AND e.plan_id=l.plan_id AND e.version=l.version WHERE e.estado_despues<>l.estado;

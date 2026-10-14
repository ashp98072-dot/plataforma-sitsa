-- SOLO LECTURA, despues de migrar. FASE 4 no inserta filas: las dos tablas deben estar VACIAS (sin backfill ni seeds).
SHOW CREATE TABLE tms_viaje_cargos_adicionales;
SHOW CREATE TABLE tms_viaje_cargo_eventos;
SELECT 'tms_viaje_cargos_adicionales' AS tabla, COUNT(*) AS filas FROM tms_viaje_cargos_adicionales
UNION ALL SELECT 'tms_viaje_cargo_eventos', COUNT(*) FROM tms_viaje_cargo_eventos;
-- Esperado en este rollout: ambas en 0.
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
   AND TABLE_NAME IN ('tms_viaje_cargos_adicionales','tms_viaje_cargo_eventos') ORDER BY TABLE_NAME, CONSTRAINT_NAME;
-- La asociacion a tabla proviene de TABLE_CONSTRAINTS, nunca de cc.TABLE_NAME (Hostinger).
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
 FROM information_schema.TABLE_CONSTRAINTS tc
 JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME IN ('tms_viaje_cargos_adicionales','tms_viaje_cargo_eventos') AND tc.CONSTRAINT_TYPE='CHECK'
 ORDER BY tc.TABLE_NAME, cc.CONSTRAINT_NAME;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('tms_viaje_cargos_adicionales','tms_viaje_cargo_eventos');
-- Auditoria de invariantes (cada una debe devolver 0 filas):
-- (a) cargo sin su evento de version vigente
SELECT c.id FROM tms_viaje_cargos_adicionales c LEFT JOIN tms_viaje_cargo_eventos e
  ON e.empresa_id=c.empresa_id AND e.cargo_id=c.id AND e.version=c.version WHERE e.id IS NULL;
-- (b) hueco en la cadena de versiones de un cargo
SELECT e.id FROM tms_viaje_cargo_eventos e LEFT JOIN tms_viaje_cargo_eventos p
  ON p.empresa_id=e.empresa_id AND p.cargo_id=e.cargo_id AND p.version=e.version-1 WHERE e.version>1 AND p.id IS NULL;
-- (c) plan del evento distinto del plan del cargo
SELECT e.id FROM tms_viaje_cargo_eventos e JOIN tms_viaje_cargos_adicionales c ON c.empresa_id=e.empresa_id AND c.id=e.cargo_id
 WHERE c.plan_id<>e.plan_id;
-- (d) estado vigente (activo) distinto del activo del ultimo evento
SELECT c.id FROM tms_viaje_cargos_adicionales c JOIN tms_viaje_cargo_eventos e
  ON e.empresa_id=c.empresa_id AND e.cargo_id=c.id AND e.version=c.version
 WHERE CAST(JSON_UNQUOTE(JSON_EXTRACT(e.estado_despues, '$.activo')) AS UNSIGNED) <> c.activo;

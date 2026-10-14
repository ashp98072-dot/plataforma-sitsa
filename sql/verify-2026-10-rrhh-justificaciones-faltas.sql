-- RRHH — Justificación de faltas — VERIFY (SOLO LECTURA; ejecutar DESPUÉS de migrar).
SHOW CREATE TABLE rrhh_asistencia_justificaciones;
-- La migración no inserta datos: esperado 0 en una instalación nueva.
SELECT COUNT(*) AS filas FROM rrhh_asistencia_justificaciones;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_asistencia_justificaciones';
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_asistencia_justificaciones' ORDER BY CONSTRAINT_NAME;
-- La asociación a tabla proviene de TABLE_CONSTRAINTS, nunca de cc.TABLE_NAME.
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
  FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_SCHEMA = DATABASE() AND tc.TABLE_NAME = 'rrhh_asistencia_justificaciones' AND tc.CONSTRAINT_TYPE = 'CHECK'
 ORDER BY cc.CONSTRAINT_NAME;
-- Auditoría de invariantes (cada una debe devolver 0 filas):
-- (a) estado fuera del dominio
SELECT id FROM rrhh_asistencia_justificaciones WHERE estado NOT IN ('ACTIVA', 'REVERTIDA');
-- (b) revertida sin motivo/actor/fecha o activa con marcas de reversión
SELECT id FROM rrhh_asistencia_justificaciones
 WHERE (estado = 'REVERTIDA' AND (revertido_por IS NULL OR revertido_en IS NULL OR motivo_reversion IS NULL))
    OR (estado = 'ACTIVA' AND (revertido_por IS NOT NULL OR revertido_en IS NOT NULL OR motivo_reversion IS NOT NULL));
-- (c) justificación de un empleado de OTRA empresa (aislamiento por tenant)
SELECT j.id FROM rrhh_asistencia_justificaciones j JOIN empleados e ON e.id = j.empleado_id WHERE e.empresa_id <> j.empresa_id;

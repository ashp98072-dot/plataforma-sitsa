-- RRHH — Justificación de faltas — PREFLIGHT (SOLO LECTURA; NO ejecutado por este PR).
-- Verifica dependencias de sql/migrate-2026-10-rrhh-justificaciones-faltas.sql.
-- Ejecutar sentencia por sentencia en la base objetivo real.
SELECT DATABASE() AS base_destino, VERSION() AS version_servidor;

-- 1) Dependencias (deben existir, InnoDB, id INT no unsigned).
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas', 'empleados', 'documentos_empleados');
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'id' AND TABLE_NAME IN ('empresas', 'empleados');

-- 2) ¿Ya existe la tabla? (0 filas = APLICAR; 1 fila = ya aplicada, la migración es NOOP; comparar SHOW CREATE TABLE).
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_asistencia_justificaciones';

-- 3) Conflictos de nombres (deben estar ausentes salvo que la tabla ya exista íntegra).
SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME IN
 ('uq_asist_just', 'fk_asist_just_empresa', 'fk_asist_just_empleado', 'ck_asist_just_estado', 'ck_asist_just_version',
  'ck_asist_just_tipo', 'ck_asist_just_reversion');

-- 4) Decisión: OK = empresas y empleados InnoDB con id INT; DETENER en otro caso.
SELECT CASE WHEN
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME IN ('empresas', 'empleados') AND ENGINE = 'InnoDB') = 2
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME IN ('empresas', 'empleados') AND COLUMN_NAME = 'id'
     AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%') = 2
  THEN 'OK' ELSE 'DETENER' END AS decision;

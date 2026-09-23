-- RRHH-TOMAR-ASISTENCIA-2 — PREFLIGHT (SOLO LECTURA; NO ejecutado por este PR).
-- Verifica dependencias de sql/migrate-2026-09-rrhh-asistencia-cierre-ausencias.sql.
-- Ajustar únicamente este literal para otra instalación y ejecutar completo.
SET @asist_schema = 'u611730801_Plataforma';
SELECT VERSION() AS version_servidor, @asist_schema AS base_destino, DATABASE() AS contexto_activo;

-- 1) Dependencias (deben existir, InnoDB, id INT no unsigned).
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @asist_schema
  AND TABLE_NAME IN ('empresas', 'empleados', 'rrhh_planilla_periodos', 'sesiones_trabajo', 'configuracion');
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @asist_schema AND COLUMN_NAME = 'id'
  AND TABLE_NAME IN ('empresas', 'empleados', 'rrhh_planilla_periodos');

-- 2) ¿Ya existen las tablas nuevas? (0 filas = APLICAR; 2 filas = ya aplicada, la migración es NOOP).
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
WHERE TABLE_SCHEMA = @asist_schema
  AND TABLE_NAME IN ('rrhh_asistencia_cierres', 'rrhh_asistencia_ausencias');

-- 3) Decisión: OK = las 3 dependencias InnoDB con id INT no unsigned; DETENER en otro caso.
SELECT CASE WHEN
  (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @asist_schema
     AND TABLE_NAME IN ('empresas', 'empleados', 'rrhh_planilla_periodos') AND ENGINE = 'InnoDB') = 3
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @asist_schema
     AND TABLE_NAME IN ('empresas', 'empleados', 'rrhh_planilla_periodos') AND COLUMN_NAME = 'id'
     AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%') = 3
  THEN 'OK' ELSE 'DETENER' END AS decision;

-- 4) Solo informativo: hoy no hay divisor guardado (la app usa 30 por defecto; opcional configurable
--    con configuracion.parametro = 'divisor_falta', entero 15–31).
SELECT empresa_id, parametro, valor FROM configuracion WHERE parametro = 'divisor_falta';

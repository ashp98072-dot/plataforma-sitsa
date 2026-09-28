-- RRHH-ENTREVISTAS-IDENTIDAD-1 — PREFLIGHT, SOLO LECTURA. NO EJECUTAR
-- AUTOMÁTICAMENTE. Ejecutar ESTE archivo primero en producción, ANTES de
-- sql/migrate-2026-09-rrhh-entrevistas-identidad.sql.
--
-- Objetivo: confirmar, con evidencia real de la base, que la tabla `entrevistas`
-- existe con la estructura que la migración asume y que las 7 columnas nuevas
-- TODAVÍA NO EXISTEN.

-- ============================================================
-- 1) Estructura actual completa de `entrevistas`.
SHOW CREATE TABLE entrevistas;

-- ============================================================
-- 2) Columnas actuales, tipos y collation.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, CHARACTER_SET_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entrevistas'
ORDER BY ORDINAL_POSITION;

-- ============================================================
-- 3) Confirmar que las 7 columnas nuevas NO existen todavía (debe devolver CERO filas).
SELECT COLUMN_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entrevistas'
  AND COLUMN_NAME IN (
    'candidato_primer_nombre', 'candidato_segundo_nombre', 'candidato_tercer_nombre', 'candidato_cuarto_nombre',
    'candidato_primer_apellido', 'candidato_segundo_apellido', 'candidato_apellido_casada'
  );

-- ============================================================
-- 4) Mismo tipo/tamaño que usa `empleados` para sus columnas de identidad
--    (la migración usa VARCHAR(80) NULL, igual que empleados.primer_nombre etc.
--    — ver sql/migrate-2026-08-rrhh-ficha-monaco.sql).
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'empleados'
  AND COLUMN_NAME IN ('primer_nombre', 'segundo_nombre', 'tercer_nombre', 'cuarto_nombre', 'primer_apellido', 'segundo_apellido', 'apellido_casada');

-- ============================================================
-- 5) Motor/collation de la tabla y versión del servidor.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entrevistas';
SELECT VERSION();

-- ============================================================
-- 6) ¿MariaDB soporta ADD COLUMN IF NOT EXISTS en esta versión? (usado ya en
--    migrate-2026-08-rrhh-ficha-monaco.sql sobre `empleados`; confirmar que el
--    mismo motor/versión aplica también a `entrevistas`).
SELECT VERSION() LIKE '%MariaDB%' AS es_mariadb;

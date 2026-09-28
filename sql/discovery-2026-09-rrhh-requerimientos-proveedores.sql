-- RRHH-REQUERIMIENTOS-PROVEEDORES-0 — PREFLIGHT, SOLO LECTURA. NO EJECUTAR
-- AUTOMÁTICAMENTE. Ejecutar ESTE archivo primero en producción, ANTES de
-- sql/migrate-2026-09-rrhh-requerimientos-proveedores.sql — ningún
-- SELECT/SHOW/DESCRIBE de aquí modifica datos ni esquema.
--
-- Objetivo: confirmar, con evidencia real de la base, los supuestos sobre
-- los que está escrita la migración:
--   1. Que empresas/cont_entidades/usuarios existen con los tipos de PK
--      que la migración asume (INT).
--   2. Que rrhh_proveedores / rrhh_requerimientos / rrhh_requerimiento_lineas
--      TODAVÍA NO EXISTEN (si alguna existe, DETENTE: puede ser de otro
--      origen y el CREATE TABLE IF NOT EXISTS sería un no-op silencioso
--      contra una estructura que no controlamos).
--   3. ENGINE/CHARSET/COLLATION reales de las tablas referenciadas por FK
--      (empresas, cont_entidades, usuarios) — deben ser compatibles con
--      InnoDB/utf8mb4/utf8mb4_unicode_ci antes de crear las FK nuevas.
--   4. Versión real de MySQL/MariaDB del hosting.

-- ============================================================
-- 1) Tablas padre que las FK nuevas van a referenciar.
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE cont_entidades;
SHOW CREATE TABLE usuarios;

-- ============================================================
-- 2) Confirmar que las 3 tablas nuevas NO existen todavía.
SELECT TABLE_NAME, ENGINE, TABLE_ROWS, CREATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('rrhh_proveedores', 'rrhh_requerimientos', 'rrhh_requerimiento_lineas');
-- Debe devolver CERO filas.

-- ============================================================
-- 3) Tipo exacto de la PK de cont_entidades.id y usuarios.id (deben ser
--    INT para que las FK compuestas/simple de la migración sean válidas).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('empresas', 'cont_entidades', 'usuarios')
  AND COLUMN_NAME IN ('id', 'empresa_id', 'activa', 'activo', 'nombre')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- ¿cont_entidades tiene UNIQUE KEY (empresa_id, id) para soportar una FK
-- compuesta (empresa_id, entidad_requirente_id)? (mismo patrón que
-- fk_cb_requerimientos_entidad en compras_requerimientos).
SHOW INDEX FROM cont_entidades WHERE Key_name <> 'PRIMARY';

-- ============================================================
-- 4) Motor/collation reales.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empresas', 'cont_entidades', 'usuarios');

-- ============================================================
-- 5) Versión del motor.
SELECT VERSION();

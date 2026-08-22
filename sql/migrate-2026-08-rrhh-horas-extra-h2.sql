-- RRHH H2 — Aplicación de horas extra APROBADA a planilla
--
-- Aditivo, no destructivo. No borra ni reinterpreta ningún dato existente.
--
-- horas_extra_registros.aplicado_en:
--   Fecha/hora en que un registro fue efectivamente aplicado a una
--   planilla (transición APROBADA -> APLICADA_EN_PLANILLA), ejecutada por
--   aplicarHorasExtraElegibles() en src/lib/rrhh/horas-extra.ts. Se agrega
--   SIN DEFAULT (NULL) — los registros existentes (PENDIENTE, APROBADA,
--   RECHAZADA, o históricos con estado NULL previos a H1) no fueron
--   aplicados a ninguna planilla bajo este modelo, así que no hay ninguna
--   fecha real que asignarles retroactivamente.
--
-- Depende de H1 (migrate-2026-08-rrhh-horas-extra-h1.sql): esta migración
-- asume que las columnas `estado` y `planilla_periodo_id` ya existen en
-- horas_extra_registros (agregadas en H1). H2 no las vuelve a crear.

SET NAMES utf8mb4;
SET @db := DATABASE();

-- =========================================================
-- horas_extra_registros.aplicado_en
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'horas_extra_registros' AND COLUMN_NAME = 'aplicado_en'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE horas_extra_registros ADD COLUMN aplicado_en DATETIME NULL AFTER planilla_periodo_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

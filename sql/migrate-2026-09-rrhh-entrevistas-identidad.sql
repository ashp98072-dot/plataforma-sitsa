-- RRHH-ENTREVISTAS-IDENTIDAD-1 — MIGRACIÓN PROPUESTA, IDEMPOTENTE. NO EJECUTAR
-- AUTOMÁTICAMENTE. Ejecutar primero el preflight de solo lectura
-- sql/discovery-2026-09-rrhh-entrevistas-identidad.sql.
--
-- Agrega identidad estructurada del candidato a `entrevistas`, mismo tipo/tamaño
-- que usan las columnas equivalentes de `empleados` (VARCHAR(80) NULL — ver
-- sql/migrate-2026-08-rrhh-ficha-monaco.sql). `candidato_nombre` NO se toca ni
-- se elimina: sigue siendo el nombre completo persistido (derivado desde estos
-- campos cuando existen, o el texto histórico tal cual para entrevistas
-- anteriores a este cambio). Sin backfill heurístico: las entrevistas ya
-- existentes quedan con estas 7 columnas en NULL hasta que RRHH las complete
-- manualmente.
SET NAMES utf8mb4;

ALTER TABLE entrevistas
  ADD COLUMN IF NOT EXISTS candidato_primer_nombre VARCHAR(80) NULL AFTER candidato_nombre,
  ADD COLUMN IF NOT EXISTS candidato_segundo_nombre VARCHAR(80) NULL AFTER candidato_primer_nombre,
  ADD COLUMN IF NOT EXISTS candidato_tercer_nombre VARCHAR(80) NULL AFTER candidato_segundo_nombre,
  ADD COLUMN IF NOT EXISTS candidato_cuarto_nombre VARCHAR(80) NULL AFTER candidato_tercer_nombre,
  ADD COLUMN IF NOT EXISTS candidato_primer_apellido VARCHAR(80) NULL AFTER candidato_cuarto_nombre,
  ADD COLUMN IF NOT EXISTS candidato_segundo_apellido VARCHAR(80) NULL AFTER candidato_primer_apellido,
  ADD COLUMN IF NOT EXISTS candidato_apellido_casada VARCHAR(80) NULL AFTER candidato_segundo_apellido;

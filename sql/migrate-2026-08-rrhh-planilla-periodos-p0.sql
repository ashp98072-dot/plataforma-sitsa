-- RRHH P0 — Integridad de periodos de planilla
--
-- Aditivo, no destructivo. Ninguna columna existente se toca, ninguna fila
-- se borra ni se reinterpreta. Periodos históricos quedan con las columnas
-- nuevas en NULL y siguen funcionando exactamente igual que antes.
--
-- tipo_periodo / numero_quincena / mes / anio:
--   Identidad opcional de quincena/mes, usada para sugerir fechas (a partir
--   de rrhh_configuracion.ciclo_quincenal, ver src/lib/rrhh/periodos.ts) y
--   para el índice único de abajo. QUINCENA_1 | QUINCENA_2 | MENSUAL | ESPECIAL.
--
-- motivo_cancelacion:
--   Obligatorio en la aplicación (no en el schema) cuando estado = 'Cancelado'.
--
-- uq_planilla_identidad:
--   Evita crear dos veces la misma quincena/mes "estándar" para la misma
--   empresa. No aplica a ESPECIAL (mes/numero_quincena quedan NULL — MySQL
--   no considera iguales dos NULL en un índice único, así que varios
--   periodos ESPECIAL conviven sin problema en este índice).
--
-- idx_periodos_fechas:
--   Soporta la verificación de solapamiento (fecha_inicio/fecha_fin) sin
--   table scan a medida que crece el historial.

SET NAMES utf8mb4;

SET @db := DATABASE();

-- =========================================================
-- Columna: tipo_periodo
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
    AND COLUMN_NAME = 'tipo_periodo'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE rrhh_planilla_periodos ADD COLUMN tipo_periodo VARCHAR(20) NULL AFTER estado',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- Columna: numero_quincena
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
    AND COLUMN_NAME = 'numero_quincena'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE rrhh_planilla_periodos ADD COLUMN numero_quincena TINYINT NULL AFTER tipo_periodo',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- Columna: mes
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
    AND COLUMN_NAME = 'mes'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE rrhh_planilla_periodos ADD COLUMN mes TINYINT NULL AFTER numero_quincena',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- Columna: anio
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
    AND COLUMN_NAME = 'anio'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE rrhh_planilla_periodos ADD COLUMN anio SMALLINT NULL AFTER mes',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- Columna: motivo_cancelacion
-- =========================================================
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
    AND COLUMN_NAME = 'motivo_cancelacion'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE rrhh_planilla_periodos ADD COLUMN motivo_cancelacion VARCHAR(300) NULL AFTER notas',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- Índice: idx_periodos_fechas
-- =========================================================
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
    AND INDEX_NAME = 'idx_periodos_fechas'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE rrhh_planilla_periodos ADD INDEX idx_periodos_fechas (empresa_id, fecha_inicio, fecha_fin)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =========================================================
-- Índice único: uq_planilla_identidad
-- =========================================================
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'rrhh_planilla_periodos'
    AND INDEX_NAME = 'uq_planilla_identidad'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE rrhh_planilla_periodos ADD UNIQUE INDEX uq_planilla_identidad (empresa_id, anio, mes, numero_quincena, tipo_periodo)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Programación / TMS P0 — datos comerciales y regreso estimado.
-- Aditiva, idempotente y sin backfill destructivo. NO ejecutar desde la app.
-- Los NULL históricos conservan el comportamiento actual.

SET NAMES utf8mb4;
SET @db := DATABASE();

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_planes_viaje'
    AND COLUMN_NAME = 'regreso_estimado'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE tms_planes_viaje ADD COLUMN regreso_estimado DATETIME NULL AFTER tipo_traslado',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_planes_viaje'
    AND COLUMN_NAME = 'tarifa_comercial'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE tms_planes_viaje ADD COLUMN tarifa_comercial DECIMAL(12,2) NULL AFTER regreso_estimado',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_planes_viaje'
    AND COLUMN_NAME = 'referencia_cliente'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE tms_planes_viaje ADD COLUMN referencia_cliente VARCHAR(160) NULL AFTER tarifa_comercial',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


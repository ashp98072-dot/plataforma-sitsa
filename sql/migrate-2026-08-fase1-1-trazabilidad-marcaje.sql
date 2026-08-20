-- Fase 1.1 - Trazabilidad de ubicación de marcajes
--
-- Permite registrar:
-- 1. La empresa real a la que pertenece el empleado.
-- 2. La ubicación física autorizada donde realizó el marcaje.
-- 3. Las coordenadas GPS recibidas del dispositivo.
-- 4. La distancia calculada contra la ubicación autorizada.
--
-- No elimina ni modifica información existente.

SET NAMES utf8mb4;

SET @db := DATABASE();

-- =========================================================
-- ubicacion_entrada_id
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'ubicacion_entrada_id'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN ubicacion_entrada_id INT NULL AFTER entrada_at',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- entrada_lat
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'entrada_lat'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN entrada_lat DECIMAL(10,7) NULL AFTER ubicacion_entrada_id',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- entrada_lng
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'entrada_lng'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN entrada_lng DECIMAL(10,7) NULL AFTER entrada_lat',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- entrada_distancia_m
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'entrada_distancia_m'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN entrada_distancia_m INT NULL AFTER entrada_lng',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- ubicacion_salida_id
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'ubicacion_salida_id'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN ubicacion_salida_id INT NULL AFTER salida_at',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- salida_lat
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'salida_lat'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN salida_lat DECIMAL(10,7) NULL AFTER ubicacion_salida_id',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- salida_lng
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'salida_lng'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN salida_lng DECIMAL(10,7) NULL AFTER salida_lat',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- salida_distancia_m
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND COLUMN_NAME = 'salida_distancia_m'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE sesiones_trabajo ADD COLUMN salida_distancia_m INT NULL AFTER salida_lng',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- Índices para ubicación
-- =========================================================

SET @idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND INDEX_NAME = 'idx_sesion_ubicacion_entrada'
);

SET @sql := IF(
  @idx = 0,
  'ALTER TABLE sesiones_trabajo ADD INDEX idx_sesion_ubicacion_entrada (ubicacion_entrada_id)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


SET @idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'sesiones_trabajo'
    AND INDEX_NAME = 'idx_sesion_ubicacion_salida'
);

SET @sql := IF(
  @idx = 0,
  'ALTER TABLE sesiones_trabajo ADD INDEX idx_sesion_ubicacion_salida (ubicacion_salida_id)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
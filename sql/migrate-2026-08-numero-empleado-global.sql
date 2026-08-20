-- Número de empleado global y automático
--
-- codigo:
--   Se conserva como código interno por empresa.
--
-- numero_empleado:
--   Identificador global único del colaborador dentro de todo el grupo.
--
-- Ejemplo:
--   id = 1   -> 000001
--   id = 27  -> 000027
--   id = 183 -> 000183

SET NAMES utf8mb4;

SET @db := DATABASE();

-- =========================================================
-- Crear columna numero_empleado
-- =========================================================

SET @col := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'empleados'
    AND COLUMN_NAME = 'numero_empleado'
);

SET @sql := IF(
  @col = 0,
  'ALTER TABLE empleados ADD COLUMN numero_empleado VARCHAR(20) NULL AFTER codigo',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- =========================================================
-- Asignar número a empleados existentes
-- =========================================================

UPDATE empleados
SET numero_empleado = LPAD(id, 6, '0')
WHERE numero_empleado IS NULL
   OR numero_empleado = '';


-- =========================================================
-- Crear índice UNIQUE global
-- =========================================================

SET @idx := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'empleados'
    AND INDEX_NAME = 'uq_empleado_numero_global'
);

SET @sql := IF(
  @idx = 0,
  'ALTER TABLE empleados ADD UNIQUE INDEX uq_empleado_numero_global (numero_empleado)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
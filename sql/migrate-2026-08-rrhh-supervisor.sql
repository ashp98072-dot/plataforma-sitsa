-- Fase 1b (autogestión RRHH): jerarquía de supervisor sobre empleados.
-- Seguro para re-ejecutar (phpMyAdmin). Si algo ya existe, se omite sin romper el resto.
SET NAMES utf8mb4;
SET @db := DATABASE();

-- empleados.supervisor_id (solo si falta)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND COLUMN_NAME = 'supervisor_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE empleados ADD COLUMN supervisor_id INT NULL AFTER centro_costo_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice para búsquedas "¿quién reporta a X?" (solo si falta)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND INDEX_NAME = 'idx_emp_supervisor'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE empleados ADD INDEX idx_emp_supervisor (empresa_id, supervisor_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK auto-referencial: si el supervisor se elimina, no se rompe el registro del subordinado
-- (queda sin supervisor en vez de fallar o borrar en cascada).
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND CONSTRAINT_NAME = 'fk_emp_supervisor'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE empleados ADD CONSTRAINT fk_emp_supervisor
     FOREIGN KEY (supervisor_id) REFERENCES empleados(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
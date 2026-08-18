-- Fase 1a (autogestión RRHH): centros de costo.
-- Seguro para re-ejecutar (phpMyAdmin). Si algo ya existe, se omite sin romper el resto.
SET NAMES utf8mb4;
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS centros_costo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(30) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_centro_costo_codigo (empresa_id, codigo),
  CONSTRAINT fk_centro_costo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- empleados.centro_costo_id (solo si falta)
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND COLUMN_NAME = 'centro_costo_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE empleados ADD COLUMN centro_costo_id INT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Índice para "empleados por centro de costo" (solo si falta)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND INDEX_NAME = 'idx_emp_centro_costo'
);
SET @sql := IF(@idx = 0,
  'ALTER TABLE empleados ADD INDEX idx_emp_centro_costo (empresa_id, centro_costo_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK: si se borra un centro de costo (no debería pasar, se desactiva en vez de
-- borrar — ver desactivarCentroCosto en centros-costo.ts), el empleado no se
-- rompe: solo se queda sin centro de costo asignado.
SET @fk := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND CONSTRAINT_NAME = 'fk_emp_centro_costo'
);
SET @sql := IF(@fk = 0,
  'ALTER TABLE empleados ADD CONSTRAINT fk_emp_centro_costo
     FOREIGN KEY (centro_costo_id) REFERENCES centros_costo(id) ON DELETE SET NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
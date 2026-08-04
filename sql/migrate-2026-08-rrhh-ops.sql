-- RRHH ops — seguro para re-ejecutar.
SET NAMES utf8mb4;
SET @db := DATABASE();

-- categoria_ops solo si falta
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'empleados' AND COLUMN_NAME = 'categoria_ops'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE empleados ADD COLUMN categoria_ops VARCHAR(40) NULL AFTER puesto',
  'SELECT ''categoria_ops ya existe'' AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS rrhh_descuentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha DATE NOT NULL,
  notas TEXT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_desc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_desc_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_prestaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  monto DECIMAL(12,2) NOT NULL DEFAULT 0,
  fecha DATE NOT NULL,
  notas TEXT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prest_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_prest_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_planilla_periodos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Borrador',
  notas TEXT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_planilla (empresa_id, codigo),
  CONSTRAINT fk_plan_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

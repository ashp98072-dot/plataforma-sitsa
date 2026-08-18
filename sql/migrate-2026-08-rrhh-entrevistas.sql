-- Calendario de entrevistas. Seguro para re-ejecutar (phpMyAdmin).
-- Si algo ya existe, se omite sin romper el resto.
SET NAMES utf8mb4;
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS entrevistas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  candidato_nombre VARCHAR(200) NOT NULL,
  candidato_telefono VARCHAR(40) NULL,
  candidato_email VARCHAR(150) NULL,
  puesto VARCHAR(150) NOT NULL,
  fecha_hora DATETIME NOT NULL,
  -- Entrevistador = un empleado activo (RRHH o el supervisor que la va a
  -- realizar). Nullable: si se borra el empleado, la entrevista no
  -- desaparece, solo queda sin entrevistador asignado.
  entrevistador_empleado_id INT NULL,
  modalidad VARCHAR(20) NOT NULL DEFAULT 'Presencial',
  lugar_o_enlace VARCHAR(255) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Programada',
  resultado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  notas TEXT NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entrev_empresa_fecha (empresa_id, fecha_hora),
  INDEX idx_entrev_entrevistador (empresa_id, entrevistador_empleado_id),
  CONSTRAINT fk_entrev_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entrev_empleado FOREIGN KEY (entrevistador_empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Por si la tabla ya existía de una corrida parcial anterior sin esta columna.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'entrevistas' AND COLUMN_NAME = 'resultado'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE entrevistas ADD COLUMN resultado VARCHAR(20) NOT NULL DEFAULT ''Pendiente'' AFTER estado',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
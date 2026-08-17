-- Fase 3a (autogestión RRHH): solicitudes de vacaciones del colaborador.
-- Seguro para re-ejecutar (phpMyAdmin). Si algo ya existe, se omite sin romper el resto.
--
-- Esta tabla es un paso PREVIO al flujo que ya existe (saldos_vacaciones /
-- registrarVacacionesFifo en src/lib/rrhh/vacaciones.ts). El colaborador
-- crea aquí una solicitud en estado 'Pendiente'; el saldo NO se descuenta
-- todavía. Solo cuando RRHH la aprueba desde el panel de staff se llama al
-- registro FIFO existente (que sí descuenta saldo y crea la incidencia),
-- y se guarda esa referencia en incidencia_id para trazabilidad.
SET NAMES utf8mb4;
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS solicitudes_vacaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Vacaciones',
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  dias_habiles DECIMAL(8,2) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  comentario_colaborador TEXT NULL,
  comentario_rrhh TEXT NULL,
  incidencia_id INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelto_en DATETIME NULL,
  resuelto_por VARCHAR(100) NULL,
  INDEX idx_solvac_empresa_emp (empresa_id, id_empleado),
  INDEX idx_solvac_estado (empresa_id, estado),
  CONSTRAINT fk_solvac_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_solvac_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE,
  CONSTRAINT fk_solvac_incidencia FOREIGN KEY (incidencia_id) REFERENCES incidencias(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Por si la tabla ya existía de una corrida parcial anterior sin esta columna.
SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'solicitudes_vacaciones' AND COLUMN_NAME = 'incidencia_id'
);
SET @sql := IF(@col = 0,
  'ALTER TABLE solicitudes_vacaciones ADD COLUMN incidencia_id INT NULL AFTER comentario_rrhh',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
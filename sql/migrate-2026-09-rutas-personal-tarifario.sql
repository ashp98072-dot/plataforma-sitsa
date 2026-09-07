-- RUTAS-PREDETERMINADOS-1
-- Aplicación MANUAL en MariaDB 11.8 antes de desplegar el código que usa
-- estos campos. No modifica viajes existentes ni copia valores a planes.

ALTER TABLE empleados
  ADD UNIQUE INDEX IF NOT EXISTS uq_ruta_personal_empresa_id (empresa_id, id);

ALTER TABLE tms_cliente_rutas
  ADD COLUMN IF NOT EXISTS tarifa_referencia DECIMAL(12,2) NULL DEFAULT NULL AFTER hora_habitual,
  ADD UNIQUE INDEX IF NOT EXISTS uq_ruta_personal_empresa_id (empresa_id, id);

CREATE TABLE IF NOT EXISTS tms_cliente_ruta_personal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  empleado_id INT NOT NULL,
  rol ENUM('Piloto', 'Auxiliar') NOT NULL,
  orden TINYINT UNSIGNED NOT NULL DEFAULT 1,
  viatico_monto DECIMAL(12,2) NULL DEFAULT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ruta_personal_empleado (ruta_id, empleado_id),
  UNIQUE KEY uq_ruta_personal_orden (ruta_id, rol, orden),
  INDEX idx_ruta_personal_empresa (empresa_id, ruta_id, rol, orden),
  INDEX idx_ruta_personal_empleado (empresa_id, empleado_id),
  CONSTRAINT fk_ruta_personal_ruta_ambito
    FOREIGN KEY (empresa_id, ruta_id)
    REFERENCES tms_cliente_rutas (empresa_id, id)
    ON DELETE CASCADE,
  CONSTRAINT fk_ruta_personal_empleado_ambito
    FOREIGN KEY (empresa_id, empleado_id)
    REFERENCES empleados (empresa_id, id)
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

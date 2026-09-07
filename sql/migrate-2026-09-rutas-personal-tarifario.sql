-- RUTAS-PREDETERMINADOS-1
-- Aplicación MANUAL en MariaDB 11.8 antes de desplegar el código que usa
-- estos campos. No modifica viajes existentes ni copia valores a planes.

-- Las migraciones de Multas ya pueden haber creado este índice con otro
-- nombre. Se detecta por composición para no duplicarlo.
SET @ruta_personal_ddl = IF(EXISTS (
  SELECT 1 FROM (
    SELECT index_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'empleados'
    GROUP BY index_name
    HAVING MIN(non_unique) = 0
       AND GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'empresa_id,id'
  ) AS indices_empleados
), 'SELECT 1',
  'ALTER TABLE empleados ADD UNIQUE KEY uq_ruta_personal_empresa_id (empresa_id, id)');
PREPARE ruta_personal_stmt FROM @ruta_personal_ddl;
EXECUTE ruta_personal_stmt;
DEALLOCATE PREPARE ruta_personal_stmt;

ALTER TABLE tms_cliente_rutas
  ADD COLUMN IF NOT EXISTS tarifa_referencia DECIMAL(12,2) NULL DEFAULT NULL AFTER hora_habitual;

SET @ruta_personal_ddl = IF(EXISTS (
  SELECT 1 FROM (
    SELECT index_name
    FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'tms_cliente_rutas'
    GROUP BY index_name
    HAVING MIN(non_unique) = 0
       AND GROUP_CONCAT(column_name ORDER BY seq_in_index) = 'empresa_id,id'
  ) AS indices_rutas
), 'SELECT 1',
  'ALTER TABLE tms_cliente_rutas ADD UNIQUE KEY uq_ruta_personal_empresa_id (empresa_id, id)');
PREPARE ruta_personal_stmt FROM @ruta_personal_ddl;
EXECUTE ruta_personal_stmt;
DEALLOCATE PREPARE ruta_personal_stmt;

CREATE TABLE IF NOT EXISTS tms_cliente_ruta_personal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  empleado_id INT NOT NULL,
  rol VARCHAR(20) NOT NULL,
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

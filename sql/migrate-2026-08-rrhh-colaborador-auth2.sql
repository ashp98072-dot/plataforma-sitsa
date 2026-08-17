-- Fase 1c: autenticación del colaborador (portal de autogestión)
-- Seguro para re-ejecutar (phpMyAdmin). Si algo ya existe, se omite sin romper el resto.
SET NAMES utf8mb4;
SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS colaborador_credenciales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empleado_id INT NOT NULL,
  username VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_acceso DATETIME NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_colab_cred_empleado (empleado_id),
  UNIQUE KEY uq_colab_cred_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @fk_exists := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = @db
    AND TABLE_NAME = 'colaborador_credenciales'
    AND CONSTRAINT_NAME = 'fk_colab_cred_empleado'
);
SET @sql := IF(@fk_exists = 0,
  'ALTER TABLE colaborador_credenciales
     ADD CONSTRAINT fk_colab_cred_empleado FOREIGN KEY (empleado_id)
     REFERENCES empleados(id) ON DELETE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db
    AND TABLE_NAME = 'colaborador_credenciales'
    AND INDEX_NAME = 'idx_colab_cred_activo'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE colaborador_credenciales ADD INDEX idx_colab_cred_activo (activo)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
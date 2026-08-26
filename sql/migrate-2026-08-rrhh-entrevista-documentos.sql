-- Papelería privada de candidatos vinculada a entrevistas.
-- Aditiva e idempotente. Ejecutar manualmente en phpMyAdmin.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS entrevista_documentos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entrevista_id INT NOT NULL,
  tipo_documento VARCHAR(100) NOT NULL DEFAULT 'Otro',
  ruta_archivo VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NULL,
  subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subido_por VARCHAR(100) NULL,
  INDEX idx_entdoc_empresa_entrevista (empresa_id, entrevista_id),
  CONSTRAINT fk_entdoc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entdoc_entrevista FOREIGN KEY (entrevista_id) REFERENCES entrevistas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

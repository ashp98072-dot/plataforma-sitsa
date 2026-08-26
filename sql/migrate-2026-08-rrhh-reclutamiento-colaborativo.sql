-- Seguimiento colaborativo del expediente de reclutamiento.
-- Aditiva e idempotente. Ejecutar manualmente en phpMyAdmin.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS entrevista_responsables (
  empresa_id INT NOT NULL,
  entrevista_id INT NOT NULL,
  usuario_id INT NOT NULL,
  asignado_por INT NULL,
  asignado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, entrevista_id, usuario_id),
  INDEX idx_entresp_usuario (empresa_id, usuario_id),
  CONSTRAINT fk_entresp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entresp_entrevista FOREIGN KEY (entrevista_id) REFERENCES entrevistas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entresp_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_entresp_asignador FOREIGN KEY (asignado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS entrevista_seguimiento (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entrevista_id INT NOT NULL,
  comentario TEXT NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_entseg_expediente (empresa_id, entrevista_id, creado_en),
  CONSTRAINT fk_entseg_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entseg_entrevista FOREIGN KEY (entrevista_id) REFERENCES entrevistas(id) ON DELETE CASCADE,
  CONSTRAINT fk_entseg_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

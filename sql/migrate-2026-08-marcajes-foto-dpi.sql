-- Evidencia fotográfica de entrada/salida del kiosco de marcajes.
-- Aditiva e idempotente. Ejecutar manualmente antes de desplegar el código.

CREATE TABLE IF NOT EXISTS marcaje_evidencias (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  sesion_id INT NOT NULL,
  tipo VARCHAR(10) NOT NULL,
  ruta_relativa VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NULL,
  tamano INT NOT NULL,
  latitud DECIMAL(10,7) NOT NULL,
  longitud DECIMAL(10,7) NOT NULL,
  ubicacion_id INT NULL,
  capturado_en DATETIME NOT NULL,
  registrado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_marcaje_evidencia_tipo (sesion_id, tipo),
  KEY idx_marcaje_evidencia_empresa (empresa_id, capturado_en),
  CONSTRAINT fk_marcaje_ev_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_marcaje_ev_sesion FOREIGN KEY (sesion_id) REFERENCES sesiones_trabajo(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

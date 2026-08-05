-- Evidencias (boletas/fotos/PDF) de vacaciones y permisos.
-- Ejecutar en phpMyAdmin sobre u611730801_Plataforma.

CREATE TABLE IF NOT EXISTS evidencias_incidencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  incidencia_id INT NOT NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NULL,
  subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subido_por VARCHAR(100) NULL,
  INDEX idx_ev_empresa (empresa_id),
  INDEX idx_ev_incidencia (incidencia_id),
  CONSTRAINT fk_ev_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_ev_inc FOREIGN KEY (incidencia_id) REFERENCES incidencias(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- documentos_empleados ya está en schema.sql; por si falta en BD vieja:
CREATE TABLE IF NOT EXISTS documentos_empleados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  id_empleado INT NOT NULL,
  tipo_documento VARCHAR(100) NULL,
  ruta_archivo VARCHAR(500) NOT NULL,
  nombre_original VARCHAR(255) NULL,
  subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subido_por VARCHAR(100) NULL,
  INDEX idx_doc_empresa (empresa_id),
  INDEX idx_doc_emp (id_empleado),
  CONSTRAINT fk_doc_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_doc_emp FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

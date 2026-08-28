-- Aplicación MANUAL, no ejecutada por la aplicación. MariaDB/MySQL, InnoDB.
-- Aditiva e idempotente para instalaciones nuevas (no modifica tablas existentes).
CREATE TABLE IF NOT EXISTS rrhh_casos_legales (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  titulo VARCHAR(200) NOT NULL,
  descripcion TEXT NOT NULL,
  empleado_id INT NULL,
  empleado_nombre VARCHAR(255) NULL,
  responsable_id INT NULL,
  responsable_nombre VARCHAR(255) NOT NULL,
  estado ENUM('Abierto','En seguimiento','Cerrado') NOT NULL DEFAULT 'Abierto',
  version INT NOT NULL DEFAULT 1,
  creado_por VARCHAR(255) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_caso_empresa (empresa_id, id),
  KEY idx_casos_estado (empresa_id, estado, id),
  CONSTRAINT fk_caso_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_caso_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL,
  CONSTRAINT fk_caso_responsable FOREIGN KEY (responsable_id) REFERENCES empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS rrhh_casos_legales_seguimientos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  caso_id INT NOT NULL,
  version INT NOT NULL,
  comentario TEXT NOT NULL,
  estado ENUM('Abierto','En seguimiento','Cerrado') NOT NULL,
  responsable_nombre VARCHAR(255) NOT NULL,
  creado_por VARCHAR(255) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_caso_version (empresa_id, caso_id, version),
  CONSTRAINT fk_seguimiento_caso FOREIGN KEY (empresa_id, caso_id)
    REFERENCES rrhh_casos_legales(empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

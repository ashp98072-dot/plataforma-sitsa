-- Inventario de equipo / herramientas (Flota / Predios)
-- Categorías de oficio, áreas físicas, herramientas empresa vs propias del empleado (RRHH).

CREATE TABLE IF NOT EXISTS flota_inv_categorias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_fic_nombre (empresa_id, nombre),
  INDEX idx_fic_emp (empresa_id),
  CONSTRAINT fk_fic_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_inv_areas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(255) NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_fia_nombre (empresa_id, nombre),
  INDEX idx_fia_emp (empresa_id),
  CONSTRAINT fk_fia_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS flota_inv_equipo (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  categoria_id INT NULL,
  -- empresa = herramienta de la compañía (ubicada en un área)
  -- empleado = herramienta propia del trabajador (RRHH)
  propiedad VARCHAR(20) NOT NULL DEFAULT 'empresa',
  area_id INT NULL,
  empleado_id INT NULL,
  empleado_nombre VARCHAR(200) NULL,
  cantidad INT NOT NULL DEFAULT 1,
  unidad VARCHAR(40) NOT NULL DEFAULT 'Unidad',
  marca VARCHAR(80) NULL,
  serie VARCHAR(120) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Activo',
  notas TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fie_codigo (empresa_id, codigo),
  INDEX idx_fie_emp (empresa_id),
  INDEX idx_fie_prop (empresa_id, propiedad),
  INDEX idx_fie_cat (categoria_id),
  INDEX idx_fie_area (area_id),
  INDEX idx_fie_empleado (empleado_id),
  CONSTRAINT fk_fie_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fase 2B. Aplicación MANUAL. No reasigna cuentas, partidas, empresas ni permisos existentes.
-- Idempotente para instalaciones sin estas tablas. Si ya existen, verificar su definición.
CREATE TABLE IF NOT EXISTS cont_entidades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_entidad_codigo (empresa_id, codigo),
  UNIQUE KEY uq_cont_entidad_empresa_id (empresa_id, id),
  CONSTRAINT fk_cont_entidad_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cont_entidad_usuarios (
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  usuario_id INT NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  puede_editar TINYINT(1) NOT NULL DEFAULT 0,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa_id, entidad_id, usuario_id),
  INDEX idx_cont_entidad_usuario (usuario_id, empresa_id, activo),
  CONSTRAINT fk_cont_eu_entidad FOREIGN KEY (empresa_id, entidad_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cont_eu_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

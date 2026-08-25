-- Portales de proveedores: credenciales cifradas y asignadas por usuario.
-- Migración aditiva e idempotente. Ejecutar manualmente una sola vez.

CREATE TABLE IF NOT EXISTS proveedor_portales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  proveedor VARCHAR(160) NOT NULL,
  nombre_portal VARCHAR(160) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  usuario_portal VARCHAR(255) NOT NULL,
  password_cifrado TEXT NOT NULL,
  asignado_usuario_id INT NOT NULL,
  notas VARCHAR(1000) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pp_empresa_asignado (empresa_id, asignado_usuario_id, activo),
  CONSTRAINT fk_pp_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_pp_asignado FOREIGN KEY (asignado_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_pp_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

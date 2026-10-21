-- PROPUESTA. Aplicar manualmente solo tras aprobar preflight físico. MariaDB 11.8.9.
-- Reejecutable sobre el contrato esperado. IF NOT EXISTS no repara un esquema divergente: DETENER si difiere.
-- No DML, seeds, backfill, borrados ni cambios en gasolinera histórica. No ejecutar desde requests/build.
CREATE TABLE IF NOT EXISTS flota_combustible_estaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  proveedor_id INT NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  direccion VARCHAR(500) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por_usuario_id INT NULL,
  actualizado_por_usuario_id INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fce_empresa_proveedor_id (empresa_id, proveedor_id, id),
  INDEX idx_fce_lista (empresa_id, proveedor_id, activo, nombre),
  CONSTRAINT fk_fce_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT fk_fce_proveedor FOREIGN KEY (empresa_id, proveedor_id) REFERENCES compras_proveedores(empresa_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT chk_fce_activo CHECK (activo IN (0,1)),
  CONSTRAINT chk_fce_nombre CHECK (CHAR_LENGTH(TRIM(nombre)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE flota_combustible_cargas
  ADD COLUMN IF NOT EXISTS estacion_id INT NULL,
  ADD INDEX IF NOT EXISTS idx_fcc_estacion (empresa_id, proveedor_id, estacion_id),
  ADD FOREIGN KEY IF NOT EXISTS fk_fcc_estacion (empresa_id, proveedor_id, estacion_id)
    REFERENCES flota_combustible_estaciones(empresa_id, proveedor_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT;

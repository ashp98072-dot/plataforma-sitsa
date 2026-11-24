-- BORRADOR: no usar para instalar. Requiere instalador controlado, contrato revisado, preflight,
-- respaldo y autorización expresa. No se ejecuta en producción desde este PR.
--
-- Prerrequisitos (en este orden): fase1, costos, salidas y redistribución de Canecas.
--
-- Qué agrega (todo aditivo, sin tocar ni reasignar datos existentes):
--   1. canecas_proveedores y canecas_clientes: catálogos EXCLUSIVOS de Canecas, aislados por empresa,
--      sin relación con compras_proveedores ni con los clientes de Operaciones.
--   2. canecas_compras.canecas_proveedor_id: proveedor de Canecas de las compras nuevas.
--   3. canecas_compras.proveedor_id pasa a admitir NULL para que las compras nuevas no necesiten un
--      proveedor de Compras. Las compras históricas conservan su proveedor_id (y su FK) intactos.
--   4. chk_can_compra_proveedor: toda compra conserva al menos un proveedor.
-- El mapeo de compras históricas a proveedores de Canecas es una acción manual y explícita; esta migración
-- nunca lo hace ni borra la relación anterior. DDL no transaccional.

CREATE TABLE canecas_proveedores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre_comercial VARCHAR(200) NOT NULL,
  nombre_normalizado VARCHAR(200) NOT NULL,
  nit VARCHAR(30) NULL,
  nit_normalizado VARCHAR(30) NULL,
  telefono VARCHAR(40) NULL,
  direccion VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_en DATETIME NULL,
  UNIQUE KEY uq_can_prov_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_prov_nombre (empresa_id,nombre_normalizado),
  UNIQUE KEY uq_can_prov_nit (empresa_id,nit_normalizado),
  CONSTRAINT chk_can_prov_nombre CHECK (CHAR_LENGTH(nombre_normalizado) > 0),
  CONSTRAINT fk_can_prov_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_prov_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_prov_editor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canecas_clientes (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre_comercial VARCHAR(200) NOT NULL,
  nombre_normalizado VARCHAR(200) NOT NULL,
  nit VARCHAR(30) NULL,
  nit_normalizado VARCHAR(30) NULL,
  telefono VARCHAR(40) NULL,
  direccion VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_en DATETIME NULL,
  UNIQUE KEY uq_can_cli_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_cli_nombre (empresa_id,nombre_normalizado),
  UNIQUE KEY uq_can_cli_nit (empresa_id,nit_normalizado),
  CONSTRAINT chk_can_cli_nombre CHECK (CHAR_LENGTH(nombre_normalizado) > 0),
  CONSTRAINT fk_can_cli_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_cli_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_cli_editor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE canecas_compras
  MODIFY proveedor_id INT NULL,
  ADD COLUMN canecas_proveedor_id INT NULL,
  ADD KEY idx_can_compra_canecas_proveedor (empresa_id,canecas_proveedor_id),
  ADD CONSTRAINT fk_can_compra_canecas_proveedor FOREIGN KEY (empresa_id,canecas_proveedor_id) REFERENCES canecas_proveedores(empresa_id,id),
  ADD CONSTRAINT chk_can_compra_proveedor CHECK (proveedor_id IS NOT NULL OR canecas_proveedor_id IS NOT NULL);

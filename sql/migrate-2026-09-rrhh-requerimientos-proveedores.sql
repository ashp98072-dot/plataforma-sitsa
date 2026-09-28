-- RRHH-REQUERIMIENTOS-PROVEEDORES-1 — MIGRACIÓN PROPUESTA. NO EJECUTAR
-- AUTOMÁTICAMENTE. Ejecutar primero el preflight de solo lectura
-- sql/discovery-2026-09-rrhh-requerimientos-proveedores.sql y confirmar
-- que las 3 tablas nuevas NO existen todavía.
--
-- Tablas PROPIAS de RRHH — independientes de compras_proveedores /
-- compras_requerimientos / compras_requerimiento_lineas (mismo patrón
-- estructural, distinto catálogo, distinta auditoría, distintos permisos).
-- Mismas convenciones que sql/migrate-2026-09-compras-base.sql: InnoDB,
-- utf8mb4/utf8mb4_unicode_ci, tipos INT, UNIQUE (empresa_id, codigo),
-- código generado con INSERT placeholder + AUTO_INCREMENT + UPDATE dentro
-- de la misma transacción (ver src/lib/rrhh/requerimientos.ts).

CREATE TABLE IF NOT EXISTS rrhh_proveedores (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre_comercial VARCHAR(200) NOT NULL,
  razon_social VARCHAR(250) NULL,
  nit VARCHAR(30) NULL,
  contacto_nombre VARCHAR(200) NULL,
  telefono VARCHAR(50) NULL,
  email VARCHAR(200) NULL,
  direccion VARCHAR(500) NULL,
  metodo_pago_habitual VARCHAR(80) NULL,
  banco VARCHAR(150) NULL,
  numero_cuenta VARCHAR(100) NULL,
  tipo_cuenta VARCHAR(80) NULL,
  dias_credito INT NULL,
  observaciones TEXT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_por INT NULL,
  actualizado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rrhh_proveedor_empresa (empresa_id, id),
  INDEX idx_rrhh_proveedor_nombre (empresa_id, activo, nombre_comercial),
  INDEX idx_rrhh_proveedor_nit (empresa_id, nit),
  CONSTRAINT fk_rh_proveedores_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_proveedores_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_proveedores_editor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rrhh_requerimientos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  fecha_requerimiento DATE NOT NULL,
  entidad_requirente_id INT NULL,
  entidad_requirente_nombre VARCHAR(200) NULL,
  requirente_usuario_id INT NULL,
  requirente_nombre VARCHAR(200) NULL,
  solicitante_usuario_id INT NULL,
  solicitante_nombre VARCHAR(200) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente',
  total DECIMAL(12,2) NOT NULL DEFAULT 0,
  observaciones TEXT NULL,
  autorizante_usuario_id INT NULL,
  autorizante_nombre VARCHAR(200) NULL,
  autorizado_en DATETIME NULL,
  rechazado_en DATETIME NULL,
  motivo_rechazo VARCHAR(1000) NULL,
  version INT NOT NULL DEFAULT 1,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_rrhh_req_empresa (empresa_id, id),
  UNIQUE KEY uq_rrhh_req_codigo (empresa_id, codigo),
  INDEX idx_rrhh_req_fecha (empresa_id, estado, fecha_requerimiento),
  CONSTRAINT chk_rrhh_req_estado CHECK (estado IN ('Pendiente', 'Autorizada', 'Rechazada')),
  CONSTRAINT fk_rh_requerimientos_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_entidad FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_requirente FOREIGN KEY (requirente_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_solicitante FOREIGN KEY (solicitante_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_autorizante FOREIGN KEY (autorizante_usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_requerimientos_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rrhh_requerimiento_lineas (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  requerimiento_id INT NOT NULL,
  orden INT NOT NULL,
  proveedor_id INT NOT NULL,
  proveedor_nombre_snapshot VARCHAR(200) NOT NULL,
  proveedor_razon_social_snapshot VARCHAR(250) NULL,
  proveedor_nit_snapshot VARCHAR(30) NULL,
  descripcion VARCHAR(1000) NOT NULL,
  cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(12,2) NOT NULL,
  metodo_pago VARCHAR(80) NOT NULL,
  condicion_pago VARCHAR(30) NOT NULL,
  banco_snapshot VARCHAR(150) NULL,
  numero_cuenta_snapshot VARCHAR(100) NULL,
  tipo_cuenta_snapshot VARCHAR(80) NULL,
  dias_credito_snapshot INT NULL,
  total DECIMAL(12,2) NOT NULL,
  observaciones TEXT NULL,
  UNIQUE KEY uq_rrhh_linea_identidad (empresa_id, requerimiento_id, id),
  INDEX idx_rrhh_linea_orden (empresa_id, requerimiento_id, orden, id),
  INDEX idx_rrhh_linea_proveedor (empresa_id, proveedor_id),
  CONSTRAINT chk_rrhh_linea_metodo CHECK (metodo_pago IN ('Transferencia', 'Cheque', 'Efectivo', 'Crédito')),
  CONSTRAINT chk_rrhh_linea_condicion CHECK (condicion_pago IN ('Contado', 'Crédito')),
  CONSTRAINT fk_rh_req_lineas_requerimiento FOREIGN KEY (empresa_id, requerimiento_id) REFERENCES rrhh_requerimientos(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_rh_req_lineas_proveedor FOREIGN KEY (empresa_id, proveedor_id) REFERENCES rrhh_proveedores(empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migración propuesta para revisión. Ejecutar únicamente después del preflight y autorización.
-- IF NOT EXISTS no corrige una tabla preexistente incompatible.
CREATE TABLE IF NOT EXISTS canecas_productos (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  marca VARCHAR(160) NOT NULL DEFAULT '',
  presentacion VARCHAR(160) NOT NULL,
  capacidad DECIMAL(12,3) NOT NULL,
  unidad_capacidad VARCHAR(40) NOT NULL,
  unidad_inventario VARCHAR(40) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_can_producto_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_producto_codigo (empresa_id,codigo),
  UNIQUE KEY uq_can_producto_presentacion (empresa_id,nombre,marca,presentacion,capacidad,unidad_capacidad),
  CONSTRAINT chk_can_capacidad CHECK (capacidad > 0),
  CONSTRAINT fk_can_producto_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canecas_ubicaciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_can_ubicacion_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_ubicacion_nombre (empresa_id,nombre),
  CONSTRAINT fk_can_ubicacion_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canecas_saldos (
  empresa_id INT NOT NULL,
  producto_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  fisico INT NOT NULL DEFAULT 0,
  reservado INT NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id,producto_id,ubicacion_id),
  CONSTRAINT chk_can_saldo CHECK (fisico >= 0 AND reservado >= 0 AND reservado <= fisico),
  CONSTRAINT fk_can_saldo_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_saldo_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canecas_compras (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  proveedor_id INT NOT NULL,
  referencia VARCHAR(250) NOT NULL,
  producto_id INT NOT NULL,
  cantidad INT NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  clave_operacion CHAR(36) NOT NULL,
  UNIQUE KEY uq_can_compra_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_compra_clave (empresa_id,clave_operacion),
  CONSTRAINT chk_can_compra_cantidad CHECK (cantidad > 0),
  CONSTRAINT fk_can_compra_proveedor FOREIGN KEY (empresa_id,proveedor_id) REFERENCES compras_proveedores(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_compra_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_compra_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canecas_recepciones (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  compra_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  recibido_por_empleado_id INT NOT NULL,
  clave_operacion CHAR(36) NOT NULL,
  cantidad INT NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmado_por INT NULL,
  confirmado_en DATETIME NULL,
  UNIQUE KEY uq_can_recepcion_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_recepcion_clave (empresa_id,clave_operacion),
  CONSTRAINT chk_can_recepcion_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_can_recepcion_estado CHECK ((estado = 'BORRADOR' AND confirmado_por IS NULL AND confirmado_en IS NULL) OR (estado = 'CONFIRMADA' AND confirmado_por IS NOT NULL AND confirmado_en IS NOT NULL)),
  CONSTRAINT fk_can_recepcion_compra FOREIGN KEY (empresa_id,compra_id) REFERENCES canecas_compras(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_recepcion_empleado FOREIGN KEY (empresa_id,recibido_por_empleado_id) REFERENCES empleados(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_recepcion_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_recepcion_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_recepcion_confirmador FOREIGN KEY (confirmado_por) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS canecas_movimientos (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  producto_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  tipo VARCHAR(30) NOT NULL,
  cantidad INT NOT NULL,
  recepcion_id INT NULL,
  movimiento_reversado_id BIGINT NULL,
  documento VARCHAR(250) NOT NULL,
  motivo VARCHAR(500) NULL,
  usuario_id INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_can_movimiento_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_movimiento_recepcion (empresa_id,recepcion_id),
  KEY idx_can_movimiento_saldo (empresa_id,producto_id,ubicacion_id,creado_en),
  CONSTRAINT chk_can_movimiento_cantidad CHECK (cantidad <> 0),
  CONSTRAINT fk_can_movimiento_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_movimiento_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_movimiento_recepcion FOREIGN KEY (empresa_id,recepcion_id) REFERENCES canecas_recepciones(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_movimiento_reversado FOREIGN KEY (empresa_id,movimiento_reversado_id) REFERENCES canecas_movimientos(empresa_id,id) ON DELETE RESTRICT,
  CONSTRAINT fk_can_movimiento_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

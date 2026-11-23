-- BORRADOR: requiere preflight, respaldo y ejecución supervisada. No ejecutar en producción.
CREATE TABLE canecas_salidas_fifo (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  producto_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  cantidad INT NOT NULL,
  documento VARCHAR(250) NOT NULL,
  clave_operacion CHAR(36) NOT NULL,
  movimiento_id BIGINT NOT NULL,
  costo_centavos DECIMAL(38,0) NOT NULL,
  moneda CHAR(3) NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversado_por INT NULL,
  reversado_en DATETIME NULL,
  motivo_reverso VARCHAR(500) NULL,
  movimiento_reverso_id BIGINT NULL,
  UNIQUE KEY uq_can_salida_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_salida_clave (empresa_id,clave_operacion),
  UNIQUE KEY uq_can_salida_mov (empresa_id,movimiento_id),
  CONSTRAINT chk_can_salida_cantidad CHECK (cantidad > 0 AND costo_centavos >= 0),
  CONSTRAINT chk_can_salida_reverso CHECK ((reversado_por IS NULL AND reversado_en IS NULL AND motivo_reverso IS NULL AND movimiento_reverso_id IS NULL) OR (reversado_por IS NOT NULL AND reversado_en IS NOT NULL AND motivo_reverso IS NOT NULL AND movimiento_reverso_id IS NOT NULL)),
  CONSTRAINT fk_can_salida_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id),
  CONSTRAINT fk_can_salida_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id),
  CONSTRAINT fk_can_salida_mov FOREIGN KEY (empresa_id,movimiento_id) REFERENCES canecas_movimientos(empresa_id,id),
  CONSTRAINT fk_can_salida_reverso FOREIGN KEY (empresa_id,movimiento_reverso_id) REFERENCES canecas_movimientos(empresa_id,id),
  CONSTRAINT fk_can_salida_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_can_salida_reversor FOREIGN KEY (reversado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canecas_salidas_fifo_capas (
  empresa_id INT NOT NULL,
  salida_id BIGINT NOT NULL,
  capa_id BIGINT NOT NULL,
  cantidad INT NOT NULL,
  costo_unitario_centavos BIGINT NOT NULL,
  moneda CHAR(3) NOT NULL,
  PRIMARY KEY (empresa_id,salida_id,capa_id),
  CONSTRAINT chk_can_salida_capa_cantidad CHECK (cantidad > 0 AND costo_unitario_centavos >= 0),
  CONSTRAINT fk_can_salida_capa_salida FOREIGN KEY (empresa_id,salida_id) REFERENCES canecas_salidas_fifo(empresa_id,id),
  CONSTRAINT fk_can_salida_capa_capa FOREIGN KEY (empresa_id,capa_id) REFERENCES canecas_capas_costo(empresa_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

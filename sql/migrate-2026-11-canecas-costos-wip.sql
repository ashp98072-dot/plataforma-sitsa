-- BORRADOR LOCAL: no usar para instalar. Pendiente de preflight y revisión integral.
-- DDL no transaccional. No rellena precios ni inventario histórico.
ALTER TABLE canecas_compras
  ADD COLUMN precio_unitario_centavos BIGINT NULL,
  ADD COLUMN gastos_centavos BIGINT NULL,
  ADD COLUMN moneda CHAR(3) NULL,
  ADD CONSTRAINT chk_can_compra_costos CHECK ((precio_unitario_centavos IS NULL OR precio_unitario_centavos >= 0) AND (gastos_centavos IS NULL OR gastos_centavos >= 0) AND ((precio_unitario_centavos IS NULL AND gastos_centavos IS NULL) OR moneda IS NOT NULL));

ALTER TABLE canecas_productos
  ADD COLUMN precio_venta_referencia_centavos BIGINT NULL,
  ADD COLUMN precio_venta_referencia_moneda CHAR(3) NULL,
  ADD CONSTRAINT chk_can_precio_venta CHECK (precio_venta_referencia_centavos IS NULL OR (precio_venta_referencia_centavos >= 0 AND precio_venta_referencia_moneda IS NOT NULL));

CREATE TABLE canecas_valoraciones_iniciales (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  producto_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  cantidad INT NOT NULL,
  costo_unitario_centavos BIGINT NULL,
  moneda CHAR(3) NULL,
  documento VARCHAR(250) NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  clave_operacion CHAR(36) NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_can_val_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_val_clave (empresa_id,clave_operacion),
  CONSTRAINT chk_can_val_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_can_val_costo CHECK (costo_unitario_centavos IS NULL OR costo_unitario_centavos >= 0),
  CONSTRAINT fk_can_val_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id),
  CONSTRAINT fk_can_val_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id),
  CONSTRAINT fk_can_val_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



CREATE TABLE canecas_capas_costo (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  producto_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  recepcion_id INT NULL,
  valoracion_id BIGINT NULL,
  segmento INT NOT NULL,
  cantidad_inicial INT NOT NULL,
  cantidad_disponible INT NOT NULL,
  costo_unitario_centavos BIGINT NULL,
  moneda CHAR(3) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_can_capa_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_capa_recepcion (empresa_id,recepcion_id,segmento),
  UNIQUE KEY uq_can_capa_valoracion (empresa_id,valoracion_id,segmento),
  KEY idx_can_capa_ubicacion (empresa_id,producto_id,ubicacion_id,creado_en,id),
  CONSTRAINT chk_can_capa_fuente CHECK ((recepcion_id IS NULL) <> (valoracion_id IS NULL)),
  CONSTRAINT chk_can_capa_cant CHECK (cantidad_inicial > 0 AND cantidad_disponible >= 0 AND cantidad_disponible <= cantidad_inicial),
  CONSTRAINT chk_can_capa_costo CHECK (costo_unitario_centavos IS NULL OR costo_unitario_centavos >= 0),
  CONSTRAINT chk_can_capa_moneda CHECK (costo_unitario_centavos IS NULL OR moneda IS NOT NULL),
  CONSTRAINT fk_can_capa_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id),
  CONSTRAINT fk_can_capa_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id),
  CONSTRAINT fk_can_capa_recepcion FOREIGN KEY (empresa_id,recepcion_id) REFERENCES canecas_recepciones(empresa_id,id),
  CONSTRAINT fk_can_capa_valoracion FOREIGN KEY (empresa_id,valoracion_id) REFERENCES canecas_valoraciones_iniciales(empresa_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Una corrección o gasto tardío se documentaría como evento independiente.
-- Su distribución entre inventario y salidas aún no está aprobada.
CREATE TABLE canecas_gastos_posteriores (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  compra_id INT NOT NULL,
  importe_centavos BIGINT NOT NULL,
  moneda CHAR(3) NOT NULL,
  fecha_documento DATE NOT NULL,
  referencia VARCHAR(250) NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  clave_operacion CHAR(36) NOT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_can_gasto_clave (empresa_id,clave_operacion),
  CONSTRAINT chk_can_gasto_positivo CHECK (importe_centavos >= 0),
  CONSTRAINT chk_can_gasto_estado CHECK (estado = 'PENDIENTE'),
  CONSTRAINT fk_can_gasto_compra FOREIGN KEY (empresa_id,compra_id) REFERENCES canecas_compras(empresa_id,id),
  CONSTRAINT fk_can_gasto_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER can_compra_costos_inmutables BEFORE UPDATE ON canecas_compras FOR EACH ROW
BEGIN
  IF (NOT (OLD.precio_unitario_centavos <=> NEW.precio_unitario_centavos) OR NOT (OLD.gastos_centavos <=> NEW.gastos_centavos) OR NOT (OLD.moneda <=> NEW.moneda) OR OLD.cantidad <> NEW.cantidad)
     AND EXISTS (SELECT 1 FROM canecas_recepciones WHERE empresa_id=OLD.empresa_id AND compra_id=OLD.id AND estado='CONFIRMADA') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Costos de compra con recepcion confirmada son inmutables';
  END IF;
END//
CREATE TRIGGER can_capa_costo_inmutable BEFORE UPDATE ON canecas_capas_costo FOR EACH ROW
BEGIN
  IF OLD.id <> NEW.id OR OLD.creado_en <> NEW.creado_en OR OLD.empresa_id <> NEW.empresa_id OR OLD.producto_id <> NEW.producto_id OR OLD.ubicacion_id <> NEW.ubicacion_id OR NOT (OLD.recepcion_id <=> NEW.recepcion_id) OR NOT (OLD.valoracion_id <=> NEW.valoracion_id) OR OLD.segmento <> NEW.segmento OR OLD.cantidad_inicial <> NEW.cantidad_inicial OR NOT (OLD.costo_unitario_centavos <=> NEW.costo_unitario_centavos) OR NOT (OLD.moneda <=> NEW.moneda) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Costo historico de capa inmutable';
  END IF;
END//
CREATE TRIGGER can_capa_no_borrar BEFORE DELETE ON canecas_capas_costo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='No se permite borrar capas';
END//
CREATE TRIGGER can_gasto_no_editar BEFORE UPDATE ON canecas_gastos_posteriores FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Gasto historico inmutable';
END//
CREATE TRIGGER can_gasto_no_borrar BEFORE DELETE ON canecas_gastos_posteriores FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='No se permite borrar gastos';
END//
CREATE TRIGGER can_valoracion_no_editar BEFORE UPDATE ON canecas_valoraciones_iniciales FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Valoracion inicial inmutable';
END//
CREATE TRIGGER can_valoracion_no_borrar BEFORE DELETE ON canecas_valoraciones_iniciales FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='No se permite borrar valoraciones';
END//
DELIMITER ;

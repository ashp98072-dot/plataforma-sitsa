-- BORRADOR: no usar para instalar. Requiere instalador controlado, contrato revisado, preflight,
-- respaldo y autorización expresa. No se ejecuta en producción desde este PR.
--
-- Prerrequisitos (en este orden): fase1, costos, salidas, redistribución y catálogos de Canecas.
--
-- Qué agrega (solo objetos nuevos; no modifica tablas ni datos existentes):
--   1. canecas_ventas: venta comercial a un cliente exclusivo de Canecas, enlazada 1:1 con su salida FIFO
--      (el costo es el costo FIFO real de esa salida). Una salida de inventario sin venta no genera ingresos.
--      Nunca se borra: la anulación cambia el estado y la salida se reversa con su traza original.
--   2. canecas_compras_mapeo_proveedor: bitácora inmutable de quién mapeó cada compra histórica a un proveedor
--      exclusivo de Canecas y cuándo. No reasigna nada por sí sola.
-- GTQ interno (CHECK). DDL no transaccional.

CREATE TABLE canecas_ventas (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  producto_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  fecha_venta DATE NOT NULL,
  documento VARCHAR(250) NOT NULL,
  cantidad INT NOT NULL,
  precio_unitario_centavos BIGINT NOT NULL,
  total_centavos DECIMAL(38,0) NOT NULL,
  costo_centavos DECIMAL(38,0) NOT NULL,
  moneda CHAR(3) NOT NULL,
  salida_id BIGINT NOT NULL,
  clave_operacion CHAR(36) NOT NULL,
  estado VARCHAR(10) NOT NULL DEFAULT 'ACTIVA',
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  anulada_por INT NULL,
  anulada_en DATETIME NULL,
  motivo_anulacion VARCHAR(500) NULL,
  UNIQUE KEY uq_can_venta_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_venta_clave (empresa_id,clave_operacion),
  UNIQUE KEY uq_can_venta_salida (empresa_id,salida_id),
  KEY idx_can_venta_fecha (empresa_id,fecha_venta,producto_id),
  KEY idx_can_venta_cliente (empresa_id,cliente_id,fecha_venta),
  CONSTRAINT chk_can_venta_importes CHECK (cantidad > 0 AND precio_unitario_centavos > 0 AND total_centavos = CAST(precio_unitario_centavos AS DECIMAL(38,0)) * cantidad AND costo_centavos >= 0 AND moneda = 'GTQ'),
  CONSTRAINT chk_can_venta_estado CHECK ((estado = 'ACTIVA' AND anulada_por IS NULL AND anulada_en IS NULL AND motivo_anulacion IS NULL) OR (estado = 'ANULADA' AND anulada_por IS NOT NULL AND anulada_en IS NOT NULL AND motivo_anulacion IS NOT NULL)),
  CONSTRAINT fk_can_venta_cliente FOREIGN KEY (empresa_id,cliente_id) REFERENCES canecas_clientes(empresa_id,id),
  CONSTRAINT fk_can_venta_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id),
  CONSTRAINT fk_can_venta_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id),
  CONSTRAINT fk_can_venta_salida FOREIGN KEY (empresa_id,salida_id) REFERENCES canecas_salidas_fifo(empresa_id,id),
  CONSTRAINT fk_can_venta_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_can_venta_anulador FOREIGN KEY (anulada_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canecas_compras_mapeo_proveedor (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  compra_id INT NOT NULL,
  proveedor_anterior_id INT NULL,
  canecas_proveedor_id INT NOT NULL,
  realizado_por INT NOT NULL,
  realizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_can_mapeo_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_mapeo_compra (empresa_id,compra_id),
  CONSTRAINT fk_can_mapeo_compra FOREIGN KEY (empresa_id,compra_id) REFERENCES canecas_compras(empresa_id,id),
  CONSTRAINT fk_can_mapeo_proveedor FOREIGN KEY (empresa_id,canecas_proveedor_id) REFERENCES canecas_proveedores(empresa_id,id),
  CONSTRAINT fk_can_mapeo_usuario FOREIGN KEY (realizado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER //
CREATE TRIGGER trg_can_venta_bu
BEFORE UPDATE ON canecas_ventas
FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
    OR NOT (NEW.empresa_id <=> OLD.empresa_id)
    OR NOT (NEW.cliente_id <=> OLD.cliente_id)
    OR NOT (NEW.producto_id <=> OLD.producto_id)
    OR NOT (NEW.ubicacion_id <=> OLD.ubicacion_id)
    OR NOT (NEW.fecha_venta <=> OLD.fecha_venta)
    OR NOT (NEW.documento <=> OLD.documento)
    OR NOT (NEW.cantidad <=> OLD.cantidad)
    OR NOT (NEW.precio_unitario_centavos <=> OLD.precio_unitario_centavos)
    OR NOT (NEW.total_centavos <=> OLD.total_centavos)
    OR NOT (NEW.costo_centavos <=> OLD.costo_centavos)
    OR NOT (NEW.moneda <=> OLD.moneda)
    OR NOT (NEW.salida_id <=> OLD.salida_id)
    OR NOT (NEW.clave_operacion <=> OLD.clave_operacion)
    OR NOT (NEW.creado_por <=> OLD.creado_por)
    OR NOT (NEW.creado_en <=> OLD.creado_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_INMUTABLE';
  END IF;
  IF OLD.estado = 'ANULADA' AND (NOT (NEW.estado <=> OLD.estado) OR NOT (NEW.anulada_por <=> OLD.anulada_por) OR NOT (NEW.anulada_en <=> OLD.anulada_en) OR NOT (NEW.motivo_anulacion <=> OLD.motivo_anulacion)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_ANULADA_INMUTABLE';
  END IF;
END//

CREATE TRIGGER trg_can_venta_bd
BEFORE DELETE ON canecas_ventas
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_VENTA_NO_ELIMINABLE';
END//

CREATE TRIGGER trg_can_mapeo_bu
BEFORE UPDATE ON canecas_compras_mapeo_proveedor
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_MAPEO_INMUTABLE';
END//

CREATE TRIGGER trg_can_mapeo_bd
BEFORE DELETE ON canecas_compras_mapeo_proveedor
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_MAPEO_NO_ELIMINABLE';
END//
DELIMITER ;

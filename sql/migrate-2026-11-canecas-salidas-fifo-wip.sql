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

DELIMITER //
CREATE TRIGGER trg_can_salida_fifo_bu
BEFORE UPDATE ON canecas_salidas_fifo
FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
    OR NOT (NEW.empresa_id <=> OLD.empresa_id)
    OR NOT (NEW.producto_id <=> OLD.producto_id)
    OR NOT (NEW.ubicacion_id <=> OLD.ubicacion_id)
    OR NOT (NEW.cantidad <=> OLD.cantidad)
    OR NOT (NEW.documento <=> OLD.documento)
    OR NOT (NEW.clave_operacion <=> OLD.clave_operacion)
    OR NOT (NEW.movimiento_id <=> OLD.movimiento_id)
    OR NOT (NEW.costo_centavos <=> OLD.costo_centavos)
    OR NOT (NEW.moneda <=> OLD.moneda)
    OR NOT (NEW.creado_por <=> OLD.creado_por)
    OR NOT (NEW.creado_en <=> OLD.creado_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_SALIDA_INMUTABLE';
  END IF;

  IF OLD.reversado_por IS NOT NULL THEN
    IF NOT (NEW.reversado_por <=> OLD.reversado_por)
      OR NOT (NEW.reversado_en <=> OLD.reversado_en)
      OR NOT (NEW.motivo_reverso <=> OLD.motivo_reverso)
      OR NOT (NEW.movimiento_reverso_id <=> OLD.movimiento_reverso_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_REVERSO_INMUTABLE';
    END IF;
  ELSEIF NOT (
    (NEW.reversado_por IS NULL AND NEW.reversado_en IS NULL AND NEW.motivo_reverso IS NULL AND NEW.movimiento_reverso_id IS NULL)
    OR
    (NEW.reversado_por IS NOT NULL AND NEW.reversado_en IS NOT NULL AND NEW.motivo_reverso IS NOT NULL AND NEW.movimiento_reverso_id IS NOT NULL)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_REVERSO_INCOMPLETO';
  END IF;
END//

CREATE TRIGGER trg_can_salida_fifo_bd
BEFORE DELETE ON canecas_salidas_fifo
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_SALIDA_NO_ELIMINABLE';
END//

CREATE TRIGGER trg_can_salida_fifo_capas_bi
BEFORE INSERT ON canecas_salidas_fifo_capas
FOR EACH ROW
BEGIN
  DECLARE v_producto INT DEFAULT NULL;
  DECLARE v_ubicacion INT DEFAULT NULL;
  DECLARE v_reversado DATETIME DEFAULT NULL;
  DECLARE v_capa_producto INT DEFAULT NULL;
  DECLARE v_capa_ubicacion INT DEFAULT NULL;
  DECLARE v_costo BIGINT DEFAULT NULL;
  DECLARE v_moneda CHAR(3) DEFAULT NULL;

  SELECT producto_id, ubicacion_id, reversado_en
    INTO v_producto, v_ubicacion, v_reversado
    FROM canecas_salidas_fifo
    WHERE empresa_id = NEW.empresa_id AND id = NEW.salida_id;

  IF v_producto IS NULL OR v_reversado IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_DETALLE_SALIDA_INVALIDO';
  END IF;

  SELECT producto_id, ubicacion_id, costo_unitario_centavos, moneda
    INTO v_capa_producto, v_capa_ubicacion, v_costo, v_moneda
    FROM canecas_capas_costo
    WHERE empresa_id = NEW.empresa_id AND id = NEW.capa_id;

  IF v_capa_producto IS NULL
    OR NOT (v_capa_producto <=> v_producto)
    OR NOT (v_capa_ubicacion <=> v_ubicacion)
    OR NOT (NEW.costo_unitario_centavos <=> v_costo)
    OR NOT (BINARY NEW.moneda <=> BINARY v_moneda) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_DETALLE_CAPA_INCOMPATIBLE';
  END IF;
END//

CREATE TRIGGER trg_can_salida_fifo_capas_bu
BEFORE UPDATE ON canecas_salidas_fifo_capas
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_DETALLE_SALIDA_INMUTABLE';
END//

CREATE TRIGGER trg_can_salida_fifo_capas_bd
BEFORE DELETE ON canecas_salidas_fifo_capas
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_DETALLE_SALIDA_NO_ELIMINABLE';
END//
DELIMITER ;

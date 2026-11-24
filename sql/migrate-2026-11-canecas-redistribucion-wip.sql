-- BORRADOR: no usar para instalar. Requiere instalador controlado, contrato revisado,
-- preflight, respaldo y autorización expresa. No se ejecuta en producción desde este PR.
--
-- Prerrequisitos (en este orden): migrate-2026-11-canecas-fase1.sql,
-- migrate-2026-11-canecas-costos-wip.sql y migrate-2026-11-canecas-salidas-fifo-wip.sql.
--
-- Qué agrega:
--   1. canecas_redistribuciones: un evento por redistribución de un lote (compra) con
--      cantidad de origen y resultante, costo total conservado y reverso.
--   2. canecas_redistribuciones_origen: capas de origen y su costo unitario histórico.
--   3. canecas_capas_costo.redistribucion_id: tercera fuente posible de una capa
--      (recepción, valoración inicial o redistribución; exactamente una).
--   4. Triggers de inmutabilidad y la actualización del trigger de capas para que
--      redistribucion_id tampoco pueda modificarse.
-- No rellena ni modifica datos existentes. DDL no transaccional.

CREATE TABLE canecas_redistribuciones (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  compra_id INT NOT NULL,
  producto_id INT NOT NULL,
  ubicacion_id INT NOT NULL,
  cantidad_origen INT NOT NULL,
  cantidad_resultante INT NOT NULL,
  diferencia INT NOT NULL,
  costo_total_centavos DECIMAL(38,0) NOT NULL,
  moneda CHAR(3) NOT NULL,
  documento VARCHAR(250) NOT NULL,
  motivo VARCHAR(500) NOT NULL,
  clave_operacion CHAR(36) NOT NULL,
  movimiento_id BIGINT NULL,
  creado_por INT NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversado_por INT NULL,
  reversado_en DATETIME NULL,
  motivo_reverso VARCHAR(500) NULL,
  movimiento_reverso_id BIGINT NULL,
  UNIQUE KEY uq_can_redis_empresa_id (empresa_id,id),
  UNIQUE KEY uq_can_redis_clave (empresa_id,clave_operacion),
  UNIQUE KEY uq_can_redis_mov (empresa_id,movimiento_id),
  KEY idx_can_redis_compra (empresa_id,compra_id,creado_en),
  CONSTRAINT chk_can_redis_cantidades CHECK (cantidad_origen > 0 AND cantidad_resultante > 0 AND diferencia = cantidad_resultante - cantidad_origen AND costo_total_centavos >= 0),
  CONSTRAINT chk_can_redis_mov CHECK ((diferencia = 0) = (movimiento_id IS NULL)),
  CONSTRAINT chk_can_redis_reverso CHECK ((reversado_por IS NULL AND reversado_en IS NULL AND motivo_reverso IS NULL AND movimiento_reverso_id IS NULL) OR (reversado_por IS NOT NULL AND reversado_en IS NOT NULL AND motivo_reverso IS NOT NULL AND ((movimiento_id IS NULL) = (movimiento_reverso_id IS NULL)))),
  CONSTRAINT fk_can_redis_compra FOREIGN KEY (empresa_id,compra_id) REFERENCES canecas_compras(empresa_id,id),
  CONSTRAINT fk_can_redis_producto FOREIGN KEY (empresa_id,producto_id) REFERENCES canecas_productos(empresa_id,id),
  CONSTRAINT fk_can_redis_ubicacion FOREIGN KEY (empresa_id,ubicacion_id) REFERENCES canecas_ubicaciones(empresa_id,id),
  CONSTRAINT fk_can_redis_mov FOREIGN KEY (empresa_id,movimiento_id) REFERENCES canecas_movimientos(empresa_id,id),
  CONSTRAINT fk_can_redis_reverso FOREIGN KEY (empresa_id,movimiento_reverso_id) REFERENCES canecas_movimientos(empresa_id,id),
  CONSTRAINT fk_can_redis_usuario FOREIGN KEY (creado_por) REFERENCES usuarios(id),
  CONSTRAINT fk_can_redis_reversor FOREIGN KEY (reversado_por) REFERENCES usuarios(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE canecas_redistribuciones_origen (
  empresa_id INT NOT NULL,
  redistribucion_id BIGINT NOT NULL,
  capa_id BIGINT NOT NULL,
  cantidad INT NOT NULL,
  costo_unitario_centavos BIGINT NOT NULL,
  moneda CHAR(3) NOT NULL,
  PRIMARY KEY (empresa_id,redistribucion_id,capa_id),
  CONSTRAINT chk_can_redis_origen CHECK (cantidad > 0 AND costo_unitario_centavos >= 0),
  CONSTRAINT fk_can_redis_origen_redis FOREIGN KEY (empresa_id,redistribucion_id) REFERENCES canecas_redistribuciones(empresa_id,id),
  CONSTRAINT fk_can_redis_origen_capa FOREIGN KEY (empresa_id,capa_id) REFERENCES canecas_capas_costo(empresa_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La capa resultante de una redistribución conserva la antigüedad (creado_en) del lote
-- original: se inserta con ese valor explícito. El trigger de capas sigue impidiendo
-- cambiar creado_en, costo, cantidad inicial y ahora también redistribucion_id.
ALTER TABLE canecas_capas_costo
  ADD COLUMN redistribucion_id BIGINT NULL,
  ADD UNIQUE KEY uq_can_capa_redistribucion (empresa_id,redistribucion_id,segmento),
  ADD CONSTRAINT fk_can_capa_redistribucion FOREIGN KEY (empresa_id,redistribucion_id) REFERENCES canecas_redistribuciones(empresa_id,id),
  DROP CONSTRAINT chk_can_capa_fuente,
  ADD CONSTRAINT chk_can_capa_fuente CHECK ((recepcion_id IS NOT NULL) + (valoracion_id IS NOT NULL) + (redistribucion_id IS NOT NULL) = 1);

DELIMITER //
DROP TRIGGER can_capa_costo_inmutable//
CREATE TRIGGER can_capa_costo_inmutable BEFORE UPDATE ON canecas_capas_costo FOR EACH ROW
BEGIN
  IF OLD.id <> NEW.id OR OLD.creado_en <> NEW.creado_en OR OLD.empresa_id <> NEW.empresa_id OR OLD.producto_id <> NEW.producto_id OR OLD.ubicacion_id <> NEW.ubicacion_id OR NOT (OLD.recepcion_id <=> NEW.recepcion_id) OR NOT (OLD.valoracion_id <=> NEW.valoracion_id) OR NOT (OLD.redistribucion_id <=> NEW.redistribucion_id) OR OLD.segmento <> NEW.segmento OR OLD.cantidad_inicial <> NEW.cantidad_inicial OR NOT (OLD.costo_unitario_centavos <=> NEW.costo_unitario_centavos) OR NOT (OLD.moneda <=> NEW.moneda) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Costo historico de capa inmutable';
  END IF;
END//

CREATE TRIGGER trg_can_redis_bu
BEFORE UPDATE ON canecas_redistribuciones
FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
    OR NOT (NEW.empresa_id <=> OLD.empresa_id)
    OR NOT (NEW.compra_id <=> OLD.compra_id)
    OR NOT (NEW.producto_id <=> OLD.producto_id)
    OR NOT (NEW.ubicacion_id <=> OLD.ubicacion_id)
    OR NOT (NEW.cantidad_origen <=> OLD.cantidad_origen)
    OR NOT (NEW.cantidad_resultante <=> OLD.cantidad_resultante)
    OR NOT (NEW.diferencia <=> OLD.diferencia)
    OR NOT (NEW.costo_total_centavos <=> OLD.costo_total_centavos)
    OR NOT (NEW.moneda <=> OLD.moneda)
    OR NOT (NEW.documento <=> OLD.documento)
    OR NOT (NEW.motivo <=> OLD.motivo)
    OR NOT (NEW.clave_operacion <=> OLD.clave_operacion)
    OR NOT (NEW.movimiento_id <=> OLD.movimiento_id)
    OR NOT (NEW.creado_por <=> OLD.creado_por)
    OR NOT (NEW.creado_en <=> OLD.creado_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_REDISTRIBUCION_INMUTABLE';
  END IF;
  IF OLD.reversado_por IS NOT NULL THEN
    IF NOT (NEW.reversado_por <=> OLD.reversado_por)
      OR NOT (NEW.reversado_en <=> OLD.reversado_en)
      OR NOT (NEW.motivo_reverso <=> OLD.motivo_reverso)
      OR NOT (NEW.movimiento_reverso_id <=> OLD.movimiento_reverso_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_REDISTRIBUCION_REVERSO_INMUTABLE';
    END IF;
  END IF;
END//

CREATE TRIGGER trg_can_redis_bd
BEFORE DELETE ON canecas_redistribuciones
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_REDISTRIBUCION_NO_ELIMINABLE';
END//

CREATE TRIGGER trg_can_redis_origen_bu
BEFORE UPDATE ON canecas_redistribuciones_origen
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_REDISTRIBUCION_ORIGEN_INMUTABLE';
END//

CREATE TRIGGER trg_can_redis_origen_bd
BEFORE DELETE ON canecas_redistribuciones_origen
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CANECAS_REDISTRIBUCION_ORIGEN_NO_ELIMINABLE';
END//
DELIMITER ;

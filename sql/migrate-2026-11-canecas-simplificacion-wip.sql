-- BORRADOR (Issue #688): NO ejecutar en producción sin respaldo, instalador controlado y autorización expresa.
-- Prerrequisitos: fase1, costos, salidas, redistribución, catálogos y ventas de Canecas ya instalados.
--
-- Cambios ADITIVOS (no elimina ni modifica datos existentes):
--   1. canecas_secuencias: contador por empresa y tipo para generar, en el servidor y sin duplicados,
--      los números de compra, de venta y los códigos de caneca.
--   2. canecas_ventas.direccion_entrega: dirección de entrega copiada en cada venta (NULL en ventas históricas),
--      para conservarla aunque luego cambie la dirección del cliente.
--   3. trg_can_venta_bu se reemplaza (DROP + CREATE) para que direccion_entrega también sea inmutable.
--      Es la única sentencia que toca un objeto existente: solo cambia un trigger, ninguna fila.
--
-- Preflight (solo lectura), debe devolver 0 filas / valores indicados:
--   SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_secuencias';  -- 0
--   SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega'; -- 0
-- Postcheck (solo lectura):
--   SHOW CREATE TABLE canecas_secuencias;  -- PK (empresa_id,tipo), FK a empresas
--   SELECT COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='canecas_ventas' AND COLUMN_NAME='direccion_entrega'; -- varchar(500), YES
--   SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='canecas_ventas'; -- 2 (bu, bd)
-- Los números ya usados por registros históricos no se reutilizan: los prefijos nuevos (COMP-, VTA-, CAN-) son distintos.
-- Reversión: DROP COLUMN direccion_entrega y DROP TABLE canecas_secuencias solo si aún no hay ventas ni compras nuevas.
-- DDL no transaccional en MariaDB.

CREATE TABLE canecas_secuencias (
  empresa_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  ultimo BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id,tipo),
  CONSTRAINT chk_can_secuencia CHECK (ultimo >= 0),
  CONSTRAINT fk_can_secuencia_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE canecas_ventas ADD COLUMN direccion_entrega VARCHAR(500) NULL AFTER ubicacion_id;

DELIMITER //
DROP TRIGGER trg_can_venta_bu//
CREATE TRIGGER trg_can_venta_bu
BEFORE UPDATE ON canecas_ventas
FOR EACH ROW
BEGIN
  IF NOT (NEW.id <=> OLD.id)
    OR NOT (NEW.empresa_id <=> OLD.empresa_id)
    OR NOT (NEW.cliente_id <=> OLD.cliente_id)
    OR NOT (NEW.producto_id <=> OLD.producto_id)
    OR NOT (NEW.ubicacion_id <=> OLD.ubicacion_id)
    OR NOT (NEW.direccion_entrega <=> OLD.direccion_entrega)
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
DELIMITER ;

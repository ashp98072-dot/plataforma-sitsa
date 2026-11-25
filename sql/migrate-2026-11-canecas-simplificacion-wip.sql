-- BORRADOR (Issue #688): requiere instalador controlado (scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs),
-- contrato revisado, preflight, respaldo restaurable y autorización expresa. No se ejecuta en producción desde este PR.
--
-- Prerrequisitos: fase 1, costos, salidas, redistribución, catálogos y ventas de Canecas instalados con su contrato exacto.
-- Las escrituras y el DDL de Canecas deben estar detenidos durante toda la instalación (DDL de MariaDB no es transaccional).
--
-- Cambios ADITIVOS (no borra ni modifica filas):
--   1. canecas_secuencias: contador por empresa y tipo para generar, en el servidor y sin duplicados, los números
--      de compra (COMP-), de venta (VTA-) y los códigos de caneca (CAN-).
--   2. canecas_ventas.direccion_entrega (NULL en ventas históricas): dirección de entrega copiada en cada venta para
--      conservarla aunque luego cambie la dirección del cliente. CHECK: no vacía cuando existe.
--   3. canecas_productos.activo_unico (columna virtual) + índice UNIQUE (empresa_id,activo_unico): la base impide más de
--      una caneca activa por empresa, de modo que una creación concurrente nunca produce dos productos activos.
--   4. trg_can_venta_bu se reemplaza con CREATE OR REPLACE TRIGGER (atómico: nunca queda sin trigger) para que
--      direccion_entrega también sea inmutable.
--
-- Orden: el ALTER de ventas va antes del trigger porque el trigger nuevo referencia la columna. Entre ambos pasos solo el
-- trigger anterior protege la tabla (la columna nueva está en NULL); por eso las escrituras deben estar detenidas.
-- Reversión supervisada: ver sql/recuperacion-canecas-simplificacion-solo-lectura.sql.

CREATE TABLE canecas_secuencias (
  empresa_id INT NOT NULL,
  tipo VARCHAR(20) NOT NULL,
  ultimo BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (empresa_id,tipo),
  CONSTRAINT chk_can_secuencia CHECK (ultimo >= 0),
  CONSTRAINT fk_can_secuencia_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE canecas_ventas
  ADD COLUMN direccion_entrega VARCHAR(500) NULL AFTER ubicacion_id,
  ADD CONSTRAINT chk_can_venta_direccion CHECK (direccion_entrega IS NULL OR CHAR_LENGTH(TRIM(direccion_entrega)) > 0);

ALTER TABLE canecas_productos
  ADD COLUMN activo_unico TINYINT(1) GENERATED ALWAYS AS (IF(activo = 1, 1, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_producto_activo_unico (empresa_id,activo_unico);

DELIMITER //
CREATE OR REPLACE TRIGGER trg_can_venta_bu
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

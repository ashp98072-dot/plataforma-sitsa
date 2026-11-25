-- BORRADOR (Issue #688): requiere instalador controlado (scripts/ci/canecas/ejecutar-simplificacion-controlado.mjs),
-- contrato revisado, preflight, respaldo restaurable y autorización expresa. No se ejecuta en producción desde este PR.
--
-- Prerrequisitos: fase 1, costos, salidas, redistribución, catálogos y ventas de Canecas instalados con su contrato exacto.
-- Las escrituras y el DDL de Canecas deben estar detenidos durante toda la instalación (DDL de MariaDB no es transaccional).
--
-- Cambios ADITIVOS (no borra ni modifica filas existentes; solo inserta en la tabla nueva canecas_secuencias):
--   1. canecas_secuencias: contador por empresa y tipo para generar, en el servidor y sin duplicados, los números
--      de compra (COMP-), de venta (VTA-) y los códigos de caneca (CAN-). Se SIEMBRA con el mayor número histórico de cada
--      empresa (referencias canecas_compras.referencia, canecas_ventas.documento y canecas_productos.codigo con formato
--      PREFIJO[ _-]?DÍGITOS, sin distinguir mayúsculas ni espacios): el primer número nuevo es máximo+1. No se rellenan huecos,
--      no se reutiliza ningún número histórico y no se renumera ni se modifica ningún documento existente.
--   2. canecas_ventas.direccion_entrega (NULL en ventas históricas): dirección de entrega copiada en cada venta para
--      conservarla aunque luego cambie la dirección del cliente. CHECK: no vacía cuando existe.
--   2b. canecas_compras.ref_auto / canecas_ventas.doc_auto (columnas virtuales) + índices UNIQUE (empresa_id,ref_auto|doc_auto): la base
--      impide dos documentos con formato generado (COMP-###### / VTA-######, 6 a 15 dígitos) en la misma empresa, tanto entre números
--      automáticos como frente a referencias escritas a mano con las APIs históricas, incluso en inserciones concurrentes. Los demás formatos
--      (texto libre) siguen aceptando duplicados como siempre: la unicidad NO es absoluta, solo para el formato generado.
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

INSERT INTO canecas_secuencias (empresa_id,tipo,ultimo)
SELECT e.id, t.tipo, COALESCE(h.maximo, 0)
FROM empresas e
CROSS JOIN (SELECT 'COMPRA' AS tipo UNION ALL SELECT 'PRODUCTO' UNION ALL SELECT 'VENTA') t
LEFT JOIN (
  SELECT empresa_id, 'COMPRA' AS tipo, MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(referencia)), '^COMP[ _-]?', '') AS UNSIGNED)) AS maximo FROM canecas_compras WHERE UPPER(TRIM(referencia)) REGEXP '^COMP[ _-]?[0-9]{1,15}$' GROUP BY empresa_id
  UNION ALL SELECT empresa_id, 'VENTA', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(documento)), '^VTA[ _-]?', '') AS UNSIGNED)) FROM canecas_ventas WHERE UPPER(TRIM(documento)) REGEXP '^VTA[ _-]?[0-9]{1,15}$' GROUP BY empresa_id
  UNION ALL SELECT empresa_id, 'PRODUCTO', MAX(CAST(REGEXP_REPLACE(UPPER(TRIM(codigo)), '^CAN[ _-]?', '') AS UNSIGNED)) FROM canecas_productos WHERE UPPER(TRIM(codigo)) REGEXP '^CAN[ _-]?[0-9]{1,15}$' GROUP BY empresa_id
) h ON h.empresa_id = e.id AND h.tipo = t.tipo;

ALTER TABLE canecas_ventas
  ADD COLUMN direccion_entrega VARCHAR(500) NULL AFTER ubicacion_id,
  ADD CONSTRAINT chk_can_venta_direccion CHECK (direccion_entrega IS NULL OR CHAR_LENGTH(TRIM(direccion_entrega)) > 0),
  ADD COLUMN doc_auto VARCHAR(250) GENERATED ALWAYS AS (IF(documento REGEXP '^VTA-[0-9]{6,15}$', documento, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_venta_doc_auto (empresa_id,doc_auto);

ALTER TABLE canecas_productos
  ADD COLUMN activo_unico TINYINT(1) GENERATED ALWAYS AS (IF(activo = 1, 1, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_producto_activo_unico (empresa_id,activo_unico);

ALTER TABLE canecas_compras
  ADD COLUMN ref_auto VARCHAR(250) GENERATED ALWAYS AS (IF(referencia REGEXP '^COMP-[0-9]{6,15}$', referencia, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_can_compra_ref_auto (empresa_id,ref_auto);

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

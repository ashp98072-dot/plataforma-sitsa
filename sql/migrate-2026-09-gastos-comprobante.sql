-- GASTOS-BUSCADORES-COMPROBANTE-PAGO-1
-- Aplicación MANUAL. No ejecutada por la aplicación.
ALTER TABLE tms_gastos_operativos
  ADD COLUMN factura_ruta_relativa VARCHAR(500) NULL AFTER tiene_factura,
  ADD COLUMN factura_nombre_original VARCHAR(255) NULL AFTER factura_ruta_relativa,
  ADD COLUMN factura_mime VARCHAR(100) NULL AFTER factura_nombre_original,
  ADD COLUMN factura_tamano BIGINT NULL AFTER factura_mime;

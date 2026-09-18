-- Propuesta: NO ejecutada por este PR. Ejecutar primero
-- preflight-2026-09-compras-documentos-linea-tipo.sql. Aplicar SOLO si no
-- hay DETENER.
--
-- COMPRAS-FASE-3-DOCUMENTOS-LINEA — amplía el CHECK de
-- compras_linea_documentos.tipo (creada en migrate-2026-09-compras-base.sql,
-- ya en producción) de 2 a 6 valores, para soportar los tipos de documento
-- pedidos por el ticket: Factura, Cotización, Orden de compra, Comprobante
-- de pago, Nota de crédito, Otro.
--
-- Aditivo: conserva 'FACTURA' y 'COMPROBANTE' tal cual (ninguna fila
-- existente deja de cumplir el CHECK), solo agrega 'COTIZACION',
-- 'ORDEN_COMPRA', 'NOTA_CREDITO', 'OTRO'. No hay backfill ni UPDATE de
-- filas — un ALTER de CHECK no reescribe datos.
--
-- MariaDB 10.2+: un CHECK con nombre se reemplaza con DROP CONSTRAINT +
-- ADD CONSTRAINT (no existe "ALTER CHECK" que reemplace la cláusula in
-- situ).
ALTER TABLE compras_linea_documentos
  DROP CONSTRAINT chk_compras_documento_tipo;

ALTER TABLE compras_linea_documentos
  ADD CONSTRAINT chk_compras_documento_tipo
  CHECK (tipo IN ('FACTURA', 'COTIZACION', 'ORDEN_COMPRA', 'COMPROBANTE', 'NOTA_CREDITO', 'OTRO'));

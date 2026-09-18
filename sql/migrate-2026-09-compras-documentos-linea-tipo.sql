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
-- MariaDB 10.2+ (servidor de producción: 11.8.x): un CHECK con nombre se
-- reemplaza con DROP CONSTRAINT + ADD CONSTRAINT (no existe "ALTER CHECK"
-- que reemplace la cláusula in situ). Ambas cláusulas van en UN SOLO
-- ALTER TABLE (separadas por coma) para que se apliquen como una única
-- operación DDL atómica — nunca queda una ventana donde el CHECK ya se
-- quitó pero todavía no se recreó. Sintaxis confirmada compatible con
-- MariaDB 10.2+ (ALTER TABLE admite múltiples cláusulas separadas por
-- coma desde siempre; DROP/ADD CONSTRAINT para CHECK existen desde 10.2,
-- cuando se introdujeron los CHECK con nombre).
ALTER TABLE compras_linea_documentos
  DROP CONSTRAINT chk_compras_documento_tipo,
  ADD CONSTRAINT chk_compras_documento_tipo
    CHECK (tipo IN ('FACTURA', 'COTIZACION', 'ORDEN_COMPRA', 'COMPROBANTE', 'NOTA_CREDITO', 'OTRO'));

-- COTIZACIONES — tratamiento del destinatario del PDF (Sr. / Sres. / Sra. / Srta.).
-- MariaDB 11.8 / InnoDB / utf8mb4. Migración ADITIVA e idempotente. NO fue ejecutada por este PR.
--
-- Agrega a tms_cotizaciones UNA columna que se guarda con la propia cotización (snapshot histórico:
-- editar luego un contacto o un cliente no cambia un PDF ya emitido):
--   atencion_tratamiento  'Sr.' | 'Sres.' | 'Sra.' | 'Srta.' (validado en la aplicación, sin CHECK; mismo criterio
--                         que documento_emisor), opcional. El tratamiento NO se deduce del nombre.
--
-- Cotizaciones existentes quedan en NULL (sin UPDATE masivo, sin backfill): su PDF muestra solo el nombre.
-- Sin DROP, sin UPDATE/INSERT/DELETE, sin cambios de PK/FK/índices.
-- Orden seguro:
--   1) ejecutar sql/preflight-2026-10-cotizaciones-tratamiento-destinatario.sql (resultado APLICAR);
--   2) ejecutar esta migración;
--   3) desplegar el código. (Crear/editar/duplicar cotizaciones escriben la columna; solo el listado y el
--      detalle toleran su ausencia temporal.)

ALTER TABLE tms_cotizaciones
  ADD COLUMN IF NOT EXISTS atencion_tratamiento VARCHAR(10) NULL AFTER atencion_nombre;

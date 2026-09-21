-- COTIZACIONES FASE 6 — DOCUMENTO COMERCIAL (PDF KuiqTrans / Logiservicios Mónaco).
-- MariaDB 11.8 / InnoDB / utf8mb4. Migración ADITIVA e idempotente. NO fue ejecutada por este PR.
--
-- Agrega a tms_cotizaciones los datos del documento que se entrega al cliente.
-- Se guardan en la propia cotización (copia del momento de emitirla), de modo
-- que un cambio posterior de defaults nunca altera un PDF ya emitido:
--   documento_emisor    marca del documento: 'KUIQTRANS' | 'MONACO'. VARCHAR, no ENUM
--                       (el catálogo se valida en la aplicación y puede crecer sin ALTER).
--                       Las cotizaciones existentes quedan con 'KUIQTRANS' por el DEFAULT de
--                       la columna: no hay UPDATE masivo ni reescritura de datos.
--   atencion_nombre     persona a quien se dirige (opcional).
--   atencion_cargo      cargo / referencia del destinatario (opcional).
--   unidad_descripcion  descripción comercial de la unidad, p. ej. "Camión 5 toneladas" (opcional).
--
-- Sin DROP, sin UPDATE/INSERT/DELETE, sin cambios de PK/FK/índices.
-- Ejecutar SOLO después de revisar sql/preflight-2026-09-cotizaciones-documento-comercial.sql (resultado APLICAR).
-- Debe aplicarse ANTES de desplegar el código de la Fase 6: el SELECT de cotizaciones ya lee estas columnas.

ALTER TABLE tms_cotizaciones
  ADD COLUMN IF NOT EXISTS documento_emisor VARCHAR(20) NOT NULL DEFAULT 'KUIQTRANS' AFTER observaciones,
  ADD COLUMN IF NOT EXISTS atencion_nombre VARCHAR(160) NULL AFTER documento_emisor,
  ADD COLUMN IF NOT EXISTS atencion_cargo VARCHAR(160) NULL AFTER atencion_nombre,
  ADD COLUMN IF NOT EXISTS unidad_descripcion VARCHAR(160) NULL AFTER atencion_cargo;

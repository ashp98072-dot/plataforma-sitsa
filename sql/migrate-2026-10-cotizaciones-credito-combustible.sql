-- COTIZACIONES — condiciones de crédito + combustible de referencia por cotización.
-- MariaDB 11.8 / InnoDB / utf8mb4. Migración ADITIVA e idempotente. NO fue ejecutada por este PR.
--
-- Agrega a tms_cotizaciones tres datos COMERCIALES que se guardan con la propia
-- cotización (snapshot histórico: nunca se recalculan ni se leen de Ajustes/costeo
-- al generar el PDF; si mañana cambia el precio del combustible, esta cotización
-- conserva el suyo):
--   condiciones_credito            texto libre, ej. "Crédito 30 días" (VARCHAR(300), opcional).
--   combustible_referencia_tipo    'diesel' | 'gasolina' | 'otro' (validado en la aplicación,
--                                  mismo criterio que documento_emisor: sin CHECK), opcional.
--   combustible_referencia_precio  precio de referencia en Q por galón, DECIMAL(12,2), opcional.
-- Separados de tarifa_referencia (referencia tarifaria de la ruta), que NO se toca.
--
-- Cotizaciones existentes quedan con las tres columnas en NULL (sin UPDATE masivo,
-- sin backfill): el detalle muestra "—" y el PDF omite esas líneas.
--
-- Sin DROP, sin UPDATE/INSERT/DELETE, sin cambios de PK/FK/índices.
-- Orden seguro:
--   1) ejecutar sql/preflight-2026-10-cotizaciones-credito-combustible.sql (resultado APLICAR);
--   2) ejecutar esta migración;
--   3) desplegar el código de este PR. (Crear/editar/duplicar cotizaciones escriben estas
--      columnas; solo el listado y el detalle toleran su ausencia temporal.)

ALTER TABLE tms_cotizaciones
  ADD COLUMN IF NOT EXISTS condiciones_credito VARCHAR(300) NULL AFTER cierre_comercial,
  ADD COLUMN IF NOT EXISTS combustible_referencia_tipo VARCHAR(20) NULL AFTER condiciones_credito,
  ADD COLUMN IF NOT EXISTS combustible_referencia_precio DECIMAL(12,2) NULL AFTER combustible_referencia_tipo;

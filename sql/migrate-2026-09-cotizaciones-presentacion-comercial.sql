-- COTIZACIONES — PDF comercial con logos reales, marca de agua y mensaje editable.
-- MariaDB 11.8 / InnoDB / utf8mb4. Migración ADITIVA e idempotente. NO fue ejecutada por este PR.
--
-- Agrega a tms_cotizaciones el SNAPSHOT del texto comercial del documento que
-- se entrega al cliente. Se guarda en la propia cotización (copia del momento
-- de emitirla), de modo que un cambio posterior del mensaje predeterminado en
-- Ajustes nunca altera un PDF ya emitido:
--   mensaje_comercial   texto introductorio ("Es un gusto saludarles…"), opcional.
--   cierre_comercial    texto de cierre ("Quedamos a sus órdenes…"), opcional.
--
-- Cotizaciones existentes quedan con ambas columnas en NULL (sin UPDATE
-- masivo); el PDF cae a un fallback determinista fijo por marca cuando el
-- valor es NULL — ver MARCAS_DOCUMENTO en src/lib/tms/cotizacion-documento.ts.
--
-- Los MENSAJES PREDETERMINADOS por marca (plantilla al crear, editable en
-- Ajustes de cotizaciones) NO requieren una tabla nueva: reutilizan la tabla
-- genérica `configuracion` (empresa_id, parametro, valor) ya existente —
-- ver src/lib/tms/cotizacion-presentacion.ts. Sin migración adicional para eso.
--
-- Sin DROP, sin UPDATE/INSERT/DELETE, sin cambios de PK/FK/índices.
-- Ejecutar SOLO después de revisar
-- sql/preflight-2026-09-cotizaciones-presentacion-comercial.sql (resultado APLICAR).
-- Debe aplicarse ANTES de desplegar el código de este PR: el SELECT de
-- cotizaciones ya lee estas columnas.

ALTER TABLE tms_cotizaciones
  ADD COLUMN IF NOT EXISTS mensaje_comercial TEXT NULL AFTER unidad_descripcion,
  ADD COLUMN IF NOT EXISTS cierre_comercial TEXT NULL AFTER mensaje_comercial;

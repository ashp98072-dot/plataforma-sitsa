-- PROGRAMACION-VIAJES-TERCERIZADOS-1 — permite marcar un viaje como
-- PROPIO (recursos internos: piloto/auxiliares/unidad de los catálogos de
-- RRHH/Flota, con toda la disponibilidad/viáticos/validación de siempre)
-- o TERCERIZADO (la empresa sigue cobrando el servicio al cliente, pero
-- lo ejecuta físicamente otra empresa/proveedor — sin catálogos internos).
-- MariaDB 11.8 / InnoDB / utf8mb4. Migración ADITIVA e idempotente.
-- NO fue ejecutada por este PR.
--
-- tipo_viaje         'Propio' | 'Tercerizado' (validado en la aplicación,
--                    mismo criterio que documento_emisor en
--                    tms_cotizaciones — VARCHAR simple, no ENUM de MySQL).
--                    DEFAULT 'Propio': todo plan existente queda
--                    conceptualmente Propio sin necesidad de UPDATE
--                    masivo ni de editar planes históricos.
--
-- Las siguientes 5 columnas son SNAPSHOTS de texto — para un viaje
-- Tercerizado, piloto_id/auxiliar_id/unidad_id de la propia tabla
-- (columnas ya existentes, sin cambios) quedan NULL a propósito: no
-- existe FK hacia tms_personal/tms_unidades para un recurso externo, así
-- que el dato se guarda tal cual se capturó, no reconstruible desde un
-- catálogo que nunca lo tuvo. Todas NULL en un viaje Propio.
--   piloto_externo_nombre       texto libre ("Juan Pérez" o "Juan Pérez -
--                                Transportes XYZ").
--   auxiliares_externos         un nombre por línea (mismo criterio que
--                                condiciones_adicionales/observaciones en
--                                tms_cotizaciones — texto con saltos de
--                                línea, no una tabla nueva: no hace falta
--                                JOIN ni orden relacional, solo mostrar
--                                la lista tal cual se capturó).
--   unidad_externa_placa        placa informativa del vehículo externo.
--   unidad_externa_descripcion  p. ej. "Camión 5 toneladas".
--   transportista_externo       proveedor/empresa transportista, texto
--                                libre (sin catálogo de proveedores
--                                nuevo — ver ticket, sección 8).
--
-- costo_tercerizado  DECIMAL opcional, informativo para control interno
--                    (NO cuentas por pagar ni integración con Compras —
--                    fuera de alcance de este ticket, ver sección 12).
--
-- Sin DROP, sin UPDATE/INSERT/DELETE, sin cambios de PK/FK/índices.
-- Ejecutar SOLO después de revisar
-- sql/preflight-2026-09-programacion-viajes-tercerizados.sql (resultado
-- APLICAR). Debe aplicarse ANTES de desplegar el código de este PR: el
-- SELECT de planes ya lee estas columnas.

ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS tipo_viaje VARCHAR(20) NOT NULL DEFAULT 'Propio' AFTER estado,
  ADD COLUMN IF NOT EXISTS piloto_externo_nombre VARCHAR(160) NULL AFTER tipo_viaje,
  ADD COLUMN IF NOT EXISTS auxiliares_externos TEXT NULL AFTER piloto_externo_nombre,
  ADD COLUMN IF NOT EXISTS unidad_externa_placa VARCHAR(40) NULL AFTER auxiliares_externos,
  ADD COLUMN IF NOT EXISTS unidad_externa_descripcion VARCHAR(160) NULL AFTER unidad_externa_placa,
  ADD COLUMN IF NOT EXISTS transportista_externo VARCHAR(160) NULL AFTER unidad_externa_descripcion,
  ADD COLUMN IF NOT EXISTS costo_tercerizado DECIMAL(12,2) NULL AFTER transportista_externo;

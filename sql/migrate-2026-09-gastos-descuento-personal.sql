-- GASTOS-OPERATIVOS-DETALLE-FORMATO-1
--
-- Aplicación MANUAL (MariaDB 11.8). NO se ejecuta automáticamente.
-- Aditiva y reejecutable (ADD COLUMN IF NOT EXISTS). Sin DROP, sin borrar
-- ni migrar datos.
--
-- Único cambio de esquema del ticket: un INDICADOR OPERATIVO opcional
-- "Descuento al personal" en tms_gastos_operativos.
--
--   * Es SOLO un flag informativo para Operaciones ("este gasto debería
--     recuperarse / descontarse al personal"). NO genera ningún descuento
--     de nómina, NO toca planilla, prestaciones, IGSS ni RRHH — el ticket
--     lo prohíbe explícitamente. Ninguna otra parte del sistema lo
--     consume salvo la pantalla de Gastos y su reporte de detalle.
--   * Default 0: los gastos existentes quedan sin marcar (comportamiento
--     idéntico al de hoy).
--
-- El resto del ticket (precarga desde el Plan/Viaje en el registro,
-- filtros separados "Fecha solicitud" / "Fecha viaje" en el reporte de
-- detalle, orden de columnas del Excel/PDF) NO necesita migración: usa
-- columnas y endpoints que ya existen (ver
-- sql/migrate-2026-09-tms-gastos-reportes.sql y
-- sql/migrate-2026-09-solicitud-fondos-reporte.sql).

ALTER TABLE tms_gastos_operativos
  ADD COLUMN IF NOT EXISTS descuento_personal TINYINT(1) NOT NULL DEFAULT 0 AFTER observaciones;

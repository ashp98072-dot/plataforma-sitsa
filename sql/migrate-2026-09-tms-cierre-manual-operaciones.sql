-- TMS-CIERRE-OPERACIONES-1 — cierre manual del plan/viaje por Operaciones,
-- sin depender de que el piloto haya completado el flujo del portal.
--
-- Esta migración es ADITIVA e IDEMPOTENTE (usa IF NOT EXISTS). NO se
-- ejecuta automáticamente en ningún flujo de la aplicación — el usuario
-- la aplica manualmente (phpMyAdmin u otro cliente) y confirma después.
-- Mismo criterio que sql/migrate-2026-08-ops-1-roles-cierre.sql.
--
-- IMPORTANTE — decisión de diseño (ver docs/TMS-CIERRE-OPERACIONES-1-
-- DISCOVERY.md §7 y el resumen de implementación): "quién" y "cuándo" ya
-- existen como columnas (`cerrado_por`/`cerrado_en`, de OPS-1) y se llenan
-- IGUAL para un cierre normal o manual — no se duplican aquí como
-- `cierre_manual_usuario_id`/`cierre_manual_fecha` para no sobrecargar el
-- modelo con dos columnas que significarían exactamente lo mismo. Solo se
-- agrega lo que NO existe todavía: el indicador de que fue manual, y el
-- motivo/comentario (obligatorio/opcional) que un cierre normal nunca
-- tiene.
--
-- Ver src/lib/tms/cierre-viaje.ts (cerrarViajeManual()).

ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS cierre_manual TINYINT(1) NOT NULL DEFAULT 0 AFTER cerrado_en,
  ADD COLUMN IF NOT EXISTS cierre_manual_motivo VARCHAR(500) NULL AFTER cierre_manual,
  ADD COLUMN IF NOT EXISTS cierre_manual_comentario VARCHAR(1000) NULL AFTER cierre_manual_motivo;

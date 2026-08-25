-- OPS-1 — Cierre operativo, roles y preparación para Facturación.
--
-- Esta migración es ADITIVA e IDEMPOTENTE (usa IF NOT EXISTS). NO se
-- ejecuta automáticamente en ningún flujo de la aplicación — el usuario
-- la aplica manualmente (phpMyAdmin u otro cliente) y confirma después.
--
-- IMPORTANTE sobre roles: los 4 roles operativos nuevos
-- (GerenteOperaciones, JefeOperaciones, AuxiliarOperaciones, Facturador)
-- NO requieren ningún cambio de esquema — usuarios.rol_global ya es
-- VARCHAR(40) (no ENUM), así que acepta cualquier valor de texto nuevo
-- sin ALTER TABLE. Este archivo solo cubre lo que SÍ requiere esquema:
-- las columnas de auditoría del cierre administrativo del viaje.

-- ============================================================
-- A) Cierre administrativo del viaje (Descargado -> Cerrado).
-- Ver src/lib/tms/cierre-viaje.ts (UPDATE condicional
-- WHERE estado = 'Descargado' -> SET estado = 'Cerrado',
-- cerrado_por = ?, cerrado_en = NOW()).
-- ============================================================
ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS cerrado_por VARCHAR(100) NULL AFTER estado,
  ADD COLUMN IF NOT EXISTS cerrado_en DATETIME NULL AFTER cerrado_por;

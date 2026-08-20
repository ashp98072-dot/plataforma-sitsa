-- Fase 0 del plan PLAN-PORTAL-PILOTOS.md: vincula tms_personal (pilotos en TMS)
-- a empleados (RRHH) con un id_empleado real, en vez de cruzar solo por nombre.
-- Idempotente: seguro correrlo más de una vez.

ALTER TABLE tms_personal
  ADD COLUMN IF NOT EXISTS id_empleado INT NULL AFTER empresa_id;

-- Backfill: intenta emparejar primero por código exacto, si no por nombre exacto,
-- siempre dentro de la misma empresa. Deja NULL lo que no logre emparejar
-- (se revisa manualmente después, no se adivina).
UPDATE tms_personal tp
JOIN empleados e
  ON e.empresa_id = tp.empresa_id
  AND (
    (tp.codigo IS NOT NULL AND tp.codigo <> '' AND e.codigo = tp.codigo)
    OR e.nombre = tp.nombre
  )
SET tp.id_empleado = e.id
WHERE tp.id_empleado IS NULL;

ALTER TABLE tms_personal
  ADD CONSTRAINT fk_tmspers_empleado
  FOREIGN KEY (id_empleado) REFERENCES empleados(id) ON DELETE SET NULL;

-- Para revisar manualmente cuáles quedaron sin vincular:
-- SELECT id, empresa_id, codigo, nombre FROM tms_personal WHERE id_empleado IS NULL;
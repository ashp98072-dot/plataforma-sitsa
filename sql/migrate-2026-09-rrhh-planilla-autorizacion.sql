-- Manual, aditiva y reejecutable. No autoriza ni modifica históricos.
ALTER TABLE rrhh_planilla_periodos
  ADD COLUMN IF NOT EXISTS autorizado_por VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS autorizado_en DATETIME NULL;

ALTER TABLE rrhh_planilla_lineas
  ADD COLUMN IF NOT EXISTS conceptos_snapshot JSON NULL;

-- MIGRACIÓN EXPLÍCITA C-1. Aplicar manualmente SOLO tras aprobar el preflight físico.
-- No ejecutada por aplicación/build/deploy. Seleccionar la BD objetivo explícitamente.
-- Precondiciones: InnoDB; viaje_id/empleado_id INT signed, piloto_nombre VARCHAR(120).
-- DETENER ante FK/CHECK incompatible o campos preexistentes con definiciones distintas.
-- Aditiva en datos: no elimina filas, no cambia IDs ni archivos ni hace backfill/seed.
-- Reejecutable sobre el esquema objetivo; no crea UNIQUE ni modifica conciliaciones.
ALTER TABLE flota_combustible_cargas
  ADD COLUMN IF NOT EXISTS proveedor_id INT NULL,
  ADD COLUMN IF NOT EXISTS observaciones VARCHAR(1000) NULL,
  MODIFY COLUMN viaje_id INT NULL,
  MODIFY COLUMN empleado_id INT NULL,
  MODIFY COLUMN piloto_nombre VARCHAR(120) NULL;
-- No FK nueva hasta verificar físicamente esquema padre y referencias históricas.
-- La aplicación valida proveedor por empresa y vehículo propio/compartido; no FK compuesta a vehículo que rompa compartidos.

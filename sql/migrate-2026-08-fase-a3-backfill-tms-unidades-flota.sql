-- Fase A3 del plan "Programación SITSA": backfill controlado de
-- tms_unidades.flota_vehiculo_id.
--
-- Requiere que Fase A1 (migrate-2026-08-fase-a1-tms-unidades-flota-vinculo.sql)
-- ya se haya ejecutado (la columna flota_vehiculo_id debe existir).
--
-- ÚNICAMENTE los 3 mappings confirmados manualmente contra producción real
-- en el diagnóstico de Fase A2 (SELECT de solo lectura, ejecutados por el
-- usuario en phpMyAdmin, no por Claude). NO es una regla automática por
-- placa: cada sentencia va con triple guarda (id + empresa_id + placa) y
-- solo aplica si la columna sigue NULL, así que correr este archivo dos
-- veces es seguro (idempotente) y si algún dato cambió entre el
-- diagnóstico y la ejecución, la sentencia correspondiente simplemente no
-- actualiza nada en vez de vincular algo incorrecto.
--
-- REVISAR ANTES DE EJECUTAR EN phpMyAdmin. No lo ejecuta Claude.

SET NAMES utf8mb4;

-- tms_unidades.id=8 (empresa_id=1, placa=C-015BNG) -> flota_vehiculos.id=1215
UPDATE tms_unidades
SET flota_vehiculo_id = 1215
WHERE id = 8
  AND empresa_id = 1
  AND placa = 'C-015BNG'
  AND flota_vehiculo_id IS NULL;

-- tms_unidades.id=9 (empresa_id=1, placa=C-147BRT) -> flota_vehiculos.id=1223
UPDATE tms_unidades
SET flota_vehiculo_id = 1223
WHERE id = 9
  AND empresa_id = 1
  AND placa = 'C-147BRT'
  AND flota_vehiculo_id IS NULL;

-- tms_unidades.id=7 (empresa_id=1, placa=C-625BZF) -> flota_vehiculos.id=1196
UPDATE tms_unidades
SET flota_vehiculo_id = 1196
WHERE id = 7
  AND empresa_id = 1
  AND placa = 'C-625BZF'
  AND flota_vehiculo_id IS NULL;

-- Verificación posterior (ejecutar después del backfill):
-- SELECT tu.id AS tms_unidad_id, tu.placa AS placa_tms, tu.flota_vehiculo_id,
--        fv.id AS flota_id, fv.placa AS placa_flota, fv.empresa_id AS empresa_duena
-- FROM tms_unidades tu
-- LEFT JOIN flota_vehiculos fv ON fv.id = tu.flota_vehiculo_id
-- WHERE tu.id IN (7, 8, 9);

-- Rollback si algo salió mal:
-- UPDATE tms_unidades SET flota_vehiculo_id = NULL WHERE id IN (7, 8, 9);

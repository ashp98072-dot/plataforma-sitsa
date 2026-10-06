-- =====================================================================
-- SOLICITUDES DE FONDO / GASTOS OPERATIVOS: VEHICULOS COMPARTIDOS
-- PROPUESTA PARA REVISION — NO EJECUTADA por Claude (CLAUDE.md seccion 4). La aplica el responsable en Hostinger,
-- despues de revisar sql/preflight-2026-10-fondos-vehiculos-compartidos.sql y ANTES de desplegar el PR.
--
-- PROBLEMA: tms_solicitud_fondo_lineas y tms_gastos_operativos tienen una FK COMPUESTA
--   (empresa_id, vehiculo_id) -> flota_vehiculos (empresa_id, id)
-- que obliga a que el vehiculo pertenezca a la MISMA empresa de la solicitud/gasto. Eso impide guardar una unidad
-- compartida (flota_vehiculo_acceso), p. ej. C-091BXF de Frescofresh solicitada desde Monaco: el INSERT falla en base
-- aunque la aplicacion ya la acepte.
--
-- CAMBIO: se reemplaza por una FK SIMPLE  vehiculo_id -> flota_vehiculos (id)  (mismo patron que tms_unidades.flota_vehiculo_id).
-- La garantia «solo propio o compartido con la empresa» pasa de la FK a la aplicacion (obtenerVehiculoAccesibleTx, la misma
-- regla de Flota). ON DELETE RESTRICT se conserva: no se puede borrar un vehiculo referenciado por una solicitud/gasto de
-- ninguna empresa.
--
-- ORDEN SEGURO (sin ventana sin FK): 1) indice, 2) FK nueva, 3) se elimina la FK compuesta vieja.
-- IDEMPOTENTE (MariaDB 11.8): se puede re-ejecutar. No toca datos ni columnas.
-- Se conservan idx_gastos_vehiculo / idx_fondolin_vehiculo (empresa_id, vehiculo_id): los usan las consultas por empresa.
-- =====================================================================

-- ---- tms_solicitud_fondo_lineas ------------------------------------
ALTER TABLE IF EXISTS tms_solicitud_fondo_lineas
  ADD INDEX IF NOT EXISTS idx_fondolin_vehiculo_id (vehiculo_id);

ALTER TABLE IF EXISTS tms_solicitud_fondo_lineas
  ADD CONSTRAINT IF NOT EXISTS fk_fondolin_vehiculo
  FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos (id) ON DELETE RESTRICT;

ALTER TABLE IF EXISTS tms_solicitud_fondo_lineas
  DROP FOREIGN KEY IF EXISTS fk_fondolin_vehiculo_ambito;

-- ---- tms_gastos_operativos -----------------------------------------
ALTER TABLE IF EXISTS tms_gastos_operativos
  ADD INDEX IF NOT EXISTS idx_gastos_vehiculo_id (vehiculo_id);

ALTER TABLE IF EXISTS tms_gastos_operativos
  ADD CONSTRAINT IF NOT EXISTS fk_gasto_vehiculo
  FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos (id) ON DELETE RESTRICT;

ALTER TABLE IF EXISTS tms_gastos_operativos
  DROP FOREIGN KEY IF EXISTS fk_gasto_vehiculo_ambito;

-- ---- Verificacion (solo lectura) -----------------------------------
-- Se espera ahora SOLO fk_fondolin_vehiculo y fk_gasto_vehiculo (vehiculo_id -> flota_vehiculos.id).
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('tms_gastos_operativos', 'tms_solicitud_fondo_lineas')
  AND REFERENCED_TABLE_NAME = 'flota_vehiculos';

-- ---- ROLLBACK (solo si NO existen filas con vehiculo de otra empresa; ver preflight, consulta 3) ----
-- ALTER TABLE tms_solicitud_fondo_lineas
--   ADD CONSTRAINT fk_fondolin_vehiculo_ambito FOREIGN KEY (empresa_id, vehiculo_id) REFERENCES flota_vehiculos (empresa_id, id) ON DELETE RESTRICT;
-- ALTER TABLE tms_solicitud_fondo_lineas DROP FOREIGN KEY fk_fondolin_vehiculo;
-- ALTER TABLE tms_gastos_operativos
--   ADD CONSTRAINT fk_gasto_vehiculo_ambito FOREIGN KEY (empresa_id, vehiculo_id) REFERENCES flota_vehiculos (empresa_id, id) ON DELETE RESTRICT;
-- ALTER TABLE tms_gastos_operativos DROP FOREIGN KEY fk_gasto_vehiculo;

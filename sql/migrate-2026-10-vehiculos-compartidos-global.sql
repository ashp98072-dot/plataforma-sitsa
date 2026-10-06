-- =====================================================================
-- VEHICULOS COMPARTIDOS EN TODOS LOS MODULOS OPERATIVOS
-- PROPUESTA PARA REVISION — NO EJECUTADA por Claude (CLAUDE.md seccion 4). La aplica el responsable en Hostinger,
-- despues de revisar sql/preflight-2026-10-vehiculos-compartidos-global.sql y ANTES de desplegar el PR.
--
-- Auditoria de FK hacia flota_vehiculos (ver docs/VEHICULOS-COMPARTIDOS-GLOBAL.md):
--   compras_requerimiento_lineas.fk_cb_requerimiento_lineas_vehiculo  (empresa_id, vehiculo_id) -> flota_vehiculos(empresa_id, id)
--       => CLASE B (debe aceptar unidades compartidas): ESTA migracion la reemplaza por FK simple. Un Requerimiento de compra de
--          Monaco sobre C-091BXF (propiedad de Frescofresh, compartida con Monaco) no se podia guardar por esta FK compuesta.
--   ops_multas_revisiones.fk_omr_vehiculo (compuesta)  => CLASE A: Multas es solo de la empresa propietaria (decision explicita
--          de MULTAS-2: «Compartir una unidad mediante flota_vehiculo_acceso NO comparte este historial»). NO SE TOCA.
--   tms_gastos_operativos / tms_solicitud_fondo_lineas => ya migradas (fondos-vehiculos-compartidos). NO SE TOCAN.
--   tms_unidades.flota_vehiculo_id, tms_planes_viaje.tc_vehiculo_id, tms_cliente_rutas.unidad_recurrente_id,
--   tms_viatico_requerimiento_lineas.vehiculo_id, flota_*.vehiculo_id => ya son FK SIMPLES: aceptan compartidas sin cambio.
--
-- CAMBIO: compras_requerimiento_lineas — FK compuesta (empresa_id, vehiculo_id) -> FK simple vehiculo_id -> flota_vehiculos(id),
-- ON DELETE RESTRICT (se conserva: no se puede borrar un vehiculo referenciado por una linea de compra de ninguna empresa).
-- La garantia «solo propio o compartido con la empresa» pasa de la FK a la aplicacion (obtenerVehiculoAccesibleTx, regla unica de Flota).
--
-- ORDEN SEGURO (sin ventana sin FK): 1) indice, 2) FK nueva, 3) se elimina la FK compuesta vieja.
-- IDEMPOTENTE (MariaDB 11.8): se puede re-ejecutar. No toca datos ni columnas.
-- =====================================================================

ALTER TABLE IF EXISTS compras_requerimiento_lineas
  ADD INDEX IF NOT EXISTS idx_compras_linea_vehiculo_id (vehiculo_id);

ALTER TABLE IF EXISTS compras_requerimiento_lineas
  ADD CONSTRAINT IF NOT EXISTS fk_cb_requerimiento_lineas_veh
  FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos (id) ON DELETE RESTRICT;

ALTER TABLE IF EXISTS compras_requerimiento_lineas
  DROP FOREIGN KEY IF EXISTS fk_cb_requerimiento_lineas_vehiculo;

-- ---- Verificacion (solo lectura) -----------------------------------
-- Se espera ahora SOLO fk_cb_requerimiento_lineas_veh (vehiculo_id -> flota_vehiculos.id).
SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME = 'compras_requerimiento_lineas'
  AND REFERENCED_TABLE_NAME = 'flota_vehiculos';

-- ---- ROLLBACK (solo si NO existen lineas con vehiculo de otra empresa; ver preflight, consulta 4) ----
-- ALTER TABLE compras_requerimiento_lineas
--   ADD CONSTRAINT fk_cb_requerimiento_lineas_vehiculo FOREIGN KEY (empresa_id, vehiculo_id) REFERENCES flota_vehiculos (empresa_id, id) ON DELETE RESTRICT;
-- ALTER TABLE compras_requerimiento_lineas DROP FOREIGN KEY fk_cb_requerimiento_lineas_veh;

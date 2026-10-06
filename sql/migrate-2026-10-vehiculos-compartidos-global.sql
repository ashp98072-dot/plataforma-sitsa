-- =====================================================================
-- VEHICULOS COMPARTIDOS EN TODOS LOS MODULOS OPERATIVOS — Compras
--
-- *** MIGRACION APLICADA MANUALMENTE EN PRODUCCION EL 2026-10-06. ***
-- *** NO VOLVER A EJECUTAR SIN VERIFICAR EL ESTADO (ver PASO 0). ***
-- Este archivo queda como REGISTRO/REFERENCIA del cambio realmente ejecutado (CLAUDE.md seccion 4: Claude no ejecuta SQL).
-- No esta pensado para re-ejecutarse automaticamente: las sentencias son DDL planas (sin IF [NOT] EXISTS, sintaxis que dio
-- problemas en MariaDB/Hostinger) y fallarian o duplicarian objetos si el cambio ya esta aplicado.
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
-- CAMBIO: compras_requerimiento_lineas — FK compuesta (empresa_id, vehiculo_id) -> FK simple
--   fk_cb_requerimiento_lineas_veh : vehiculo_id -> flota_vehiculos(id), ON DELETE RESTRICT
-- con el indice idx_compras_req_linea_vehiculo_id (vehiculo_id). ON DELETE RESTRICT se conserva: no se puede borrar un vehiculo
-- referenciado por una linea de compra de ninguna empresa. La garantia «solo propio o compartido con la empresa» pasa de la FK a la
-- aplicacion (obtenerVehiculoAccesibleTx, regla unica de Flota).
--
-- ORDEN SEGURO (sin ventana sin FK): 1) indice, 2) FK nueva, 3) se elimina la FK compuesta vieja.
-- Datos previos a la migracion (preflight del 2026-10-06): 0 huerfanos, 0 referencias cruzadas entre empresas, FK compuesta
-- antigua confirmada. No toca datos ni columnas.
-- =====================================================================

-- ---- PASO 0 — VERIFICACION PREVIA (solo lectura) --------------------
-- Antes de aplicar (estado original): debe aparecer fk_cb_requerimiento_lineas_vehiculo con 2 columnas (empresa_id, vehiculo_id)
-- y NO debe existir fk_cb_requerimiento_lineas_veh. Si ya aparece fk_cb_requerimiento_lineas_veh con 1 columna (vehiculo_id), la
-- migracion YA esta aplicada: NO ejecutar los pasos 1 a 3.
SELECT CONSTRAINT_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columnas, REFERENCED_TABLE_NAME,
       GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columnas_ref
FROM information_schema.KEY_COLUMN_USAGE
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME = 'compras_requerimiento_lineas'
  AND REFERENCED_TABLE_NAME = 'flota_vehiculos'
GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME;

SHOW INDEX FROM compras_requerimiento_lineas WHERE Column_name = 'vehiculo_id';

-- ---- PASO 1 — indice (DDL ejecutado) --------------------------------
ALTER TABLE compras_requerimiento_lineas
  ADD INDEX idx_compras_req_linea_vehiculo_id (vehiculo_id);

-- ---- PASO 2 — FK simple nueva (DDL ejecutado) -----------------------
ALTER TABLE compras_requerimiento_lineas
  ADD CONSTRAINT fk_cb_requerimiento_lineas_veh
  FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos (id) ON DELETE RESTRICT;

-- ---- PASO 3 — se elimina la FK compuesta antigua (DDL ejecutado) ----
ALTER TABLE compras_requerimiento_lineas
  DROP FOREIGN KEY fk_cb_requerimiento_lineas_vehiculo;

-- ---- PASO 4 — VERIFICACION POSTERIOR (solo lectura) -----------------
-- Estado final verificado en produccion:
--   * FK vigente: fk_cb_requerimiento_lineas_veh, columnas = vehiculo_id, referencia = flota_vehiculos(id).
--   * fk_cb_requerimiento_lineas_vehiculo ya NO existe como foreign key.
--   * Indice idx_compras_req_linea_vehiculo_id con vehiculo_id en SEQ_IN_INDEX = 1.
SELECT CONSTRAINT_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columnas, REFERENCED_TABLE_NAME,
       GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY ORDINAL_POSITION) AS columnas_ref
FROM information_schema.KEY_COLUMN_USAGE
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND TABLE_NAME = 'compras_requerimiento_lineas'
  AND REFERENCED_TABLE_NAME = 'flota_vehiculos'
GROUP BY CONSTRAINT_NAME, REFERENCED_TABLE_NAME;

SHOW INDEX FROM compras_requerimiento_lineas WHERE Column_name = 'vehiculo_id';

-- ---- ROLLBACK (referencia; solo si NO existen lineas con vehiculo de otra empresa) ----
-- ALTER TABLE compras_requerimiento_lineas
--   ADD CONSTRAINT fk_cb_requerimiento_lineas_vehiculo FOREIGN KEY (empresa_id, vehiculo_id) REFERENCES flota_vehiculos (empresa_id, id) ON DELETE RESTRICT;
-- ALTER TABLE compras_requerimiento_lineas DROP FOREIGN KEY fk_cb_requerimiento_lineas_veh;

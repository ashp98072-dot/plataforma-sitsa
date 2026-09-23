-- PROGRAMACION-TC-CAJA-REMOLQUE-1 — asignación de TC / caja / remolque por
-- viaje. Migración ADITIVA: solo agrega columnas, un índice y una FK. No
-- modifica ni elimina datos existentes, y ningún registro existente cambia
-- de comportamiento (todo vehículo existente queda como 'VEHICULO' por
-- DEFAULT, y ningún plan existente tiene TC).
--
-- REVISAR ANTES DE EJECUTAR EN phpMyAdmin. No lo ejecuta Claude. Correr
-- primero sql/preflight-2026-09-programacion-tc-caja-remolque.sql.
--
-- MODELO
--   flota_vehiculos.tipo_unidad  VARCHAR(20) NOT NULL DEFAULT 'VEHICULO'
--     Clasificación formal de la unidad: 'VEHICULO' (camión/panel normal),
--     'CABEZAL' o 'TC' (TC / caja / remolque). Catálogo validado en la
--     aplicación (src/lib/flota/tipo-unidad.ts), mismo criterio que
--     tms_planes_viaje.tipo_viaje / tms_cotizaciones.documento_emisor: sin
--     CHECK, para que agregar un valor futuro no exija otra migración.
--     Los TC ya registrados como vehículos se REUTILIZAN (no se crea un
--     catálogo nuevo): solo hay que clasificarlos (ver más abajo).
--
--   tms_planes_viaje.tc_vehiculo_id      INT NULL  -> flota_vehiculos.id
--     Viaje PROPIO: el TC interno asignado a ESTE viaje (no al cabezal de
--     forma permanente: el mismo cabezal puede llevar TC distintos en días
--     distintos). Nunca se guarda en unidad_id (unidad y TC son recursos
--     distintos). NULL = viaje sin TC (camión, panel, etc.).
--   tms_planes_viaje.tc_placa_historica  VARCHAR(40) NULL
--     Fotografía de la placa del TC interno al asignarlo (mismo criterio
--     que ruta_codigo_historico/tarifa_nombre_historico): si el vehículo se
--     renombra o se borra, el viaje conserva lo que se programó.
--   tms_planes_viaje.tc_externo_placa    VARCHAR(40) NULL
--     Viaje TERCERIZADO: TC del proveedor, solo texto (snapshot). Nunca
--     crea flota_vehiculos ni tms_unidades. Los dos campos (interno vs
--     externo) NO se mezclan en una sola columna ambigua.
--
-- Las columnas y el índice usan IF NOT EXISTS (MariaDB), así que re-ejecutar
-- esas partes es inocuo. La FK (último ALTER) NO es idempotente: si ya
-- existe, fallará con "Duplicate foreign key" sin dañar nada — no repetir
-- sin revisar. La FK simple a flota_vehiculos(id) sigue el mismo patrón que
-- fk_tmsuni_flota (tms_unidades.flota_vehiculo_id, INT NULL, ON DELETE SET
-- NULL). Si la FK fallara con errno 150 en algún entorno (tipos distintos
-- de flota_vehiculos.id), omitir SOLO ese último ALTER: la aplicación valida
-- empresa/acceso al guardar y el resto funciona igual.

SET NAMES utf8mb4;

ALTER TABLE flota_vehiculos
  ADD COLUMN IF NOT EXISTS tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO' AFTER descripcion;

ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS tc_vehiculo_id INT NULL AFTER unidad_id,
  ADD COLUMN IF NOT EXISTS tc_placa_historica VARCHAR(40) NULL AFTER tc_vehiculo_id,
  ADD COLUMN IF NOT EXISTS tc_externo_placa VARCHAR(40) NULL AFTER tc_placa_historica;

-- Disponibilidad diaria del TC: (empresa, tc, fecha).
ALTER TABLE tms_planes_viaje
  ADD INDEX IF NOT EXISTS idx_tmsplan_tc_fecha (empresa_id, tc_vehiculo_id, fecha_plan);

ALTER TABLE tms_planes_viaje
  ADD CONSTRAINT fk_tmsplan_tc_vehiculo
  FOREIGN KEY (tc_vehiculo_id) REFERENCES flota_vehiculos(id)
  ON DELETE SET NULL;

-- ============================================================================
-- CÓMO MARCAR LOS TC YA REGISTRADOS (PASO MANUAL, SEPARADO, NO AUTOMÁTICO)
--
-- Hoy los TC están cargados como vehículos y NO existe ninguna marca formal
-- que los distinga (ni tipo/clase/categoría en flota_vehiculos; la placa, la
-- marca o la descripción no son una regla formal y no se usan para
-- adivinar). Esta migración NO clasifica nada: TODOS quedan 'VEHICULO'.
-- No se hace ningún UPDATE masivo.
--
-- Opción A (recomendada, sin SQL): Flota > Vehículos > editar la unidad >
-- "Tipo de unidad" = TC (o Cabezal). Una unidad a la vez.
--
-- Opción B (SQL, solo tras revisar la lista): listar y decidir a mano.
--   SELECT id, empresa_id, placa, marca, modelo, descripcion, tipo_unidad
--   FROM flota_vehiculos WHERE activo = 1 ORDER BY empresa_id, placa;
-- y luego, por placas EXPLÍCITAS y de UNA empresa:
--   -- UPDATE flota_vehiculos SET tipo_unidad = 'TC'
--   --   WHERE empresa_id = <ID> AND placa IN ('TC-01', 'TC-07');
-- (dejado como comentario a propósito: no ejecutar sin revisar.)
-- ============================================================================

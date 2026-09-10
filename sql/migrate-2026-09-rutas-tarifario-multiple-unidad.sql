-- RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1
--
-- Aplicación MANUAL (MariaDB 11.8, mismo motor que el resto del proyecto).
-- NO se ejecuta automáticamente. Aditiva y reejecutable
-- (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS) — correr este
-- script más de una vez es seguro. Sin DROP, sin borrar datos, sin tocar
-- migraciones ya aplicadas.
--
-- Contexto (esquema real revisado antes de diseñar — ver
-- sql/schema.sql:781-806, sql/migrate-2026-09-rutas-tarifario-historial.sql):
--
--   * `tms_cliente_rutas.tarifa_referencia` YA EXISTE como el valor
--     VIGENTE único de la ruta — se MANTIENE sin cambios: lo leen
--     ruta-defaults.ts, cotizaciones.ts, rutas-export-excel.ts,
--     rutas-import.ts. Este ticket lo deja intacto y lo mantiene
--     sincronizado con la tarifa PREDETERMINADA activa del catálogo nuevo
--     (compatibilidad total con todo lo que ya lo consume).
--
--   * `tms_cliente_ruta_tarifas` YA EXISTE y funciona como HISTORIAL
--     append-only de cambios de `tarifa_referencia` (registrarCambioTarifaTx
--     / listarHistorialTarifas). NO se toca — no es un catálogo de
--     opciones y este ticket no lo convierte en uno.
--
-- Lo que este ticket agrega:
--
--   1. `tms_ruta_tarifas` — CATÁLOGO de opciones de tarifa: una ruta puede
--      tener varias tarifas activas al mismo tiempo (p. ej. "Tarifa
--      normal", "Tarifa lluvia", "Tarifa cliente X"). Cada viaje elige una
--      y guarda su SNAPSHOT (ver punto 3): si mañana cambia la tarifa
--      maestra, los viajes anteriores NO cambian de monto.
--      "Solo una predeterminada activa por ruta" se garantiza en la capa
--      de aplicación dentro de la misma transacción (mismo criterio que
--      guardarPersonalRuta) — la auditoría de cambios va a la tabla
--      `auditoria` genérica (helper registrarAuditoria), más
--      `actualizado_por`/`actualizado_en` en la propia fila.
--
--   2. `tms_cliente_rutas.unidad_recurrente_id` — unidad habitual de la
--      ruta, OPCIONAL, referida a `flota_vehiculos`. FK SIMPLE a
--      flota_vehiculos(id) ON DELETE SET NULL — EXACTAMENTE el mismo
--      patrón ya probado en producción para tms_unidades.flota_vehiculo_id
--      (fk_tmsuni_flota). NO se usa una FK compuesta (empresa_id, ...):
--      acoplar tms_cliente_rutas.empresa_id (columna antigua) al tipo de
--      flota_vehiculos.empresa_id (que en producción puede diferir por
--      venir de control-flota) provoca errno 150. El aislamiento por
--      empresa se garantiza en la capa de aplicación
--      (validarUnidadRecurrenteTx: `WHERE id = ? AND empresa_id = ?`),
--      mismo criterio ya documentado para tms_unidades.flota_vehiculo_id
--      ("Tener flota_vehiculo_id NUNCA autoriza acceso por sí mismo:
--      siempre se verifica"). Programación la precarga como sugerencia;
--      cambiar la unidad de un viaje NO cambia esta configuración.
--
--   3. `tms_planes_viaje` — snapshot de la tarifa usada en el viaje:
--      `tarifa_id` (informativo, SIN FK — mismo criterio que `ruta_id`,
--      la fila maestra puede cambiar o desactivarse después),
--      `tarifa_nombre_historico`, `tarifa_monto_historico`,
--      `tarifa_moneda_historico`. `tarifa_comercial` (ya existente) sigue
--      siendo el monto realmente cobrado del viaje (editable como
--      override) y el que ya usan los reportes de ingresos.
--
--   4. Seed: por cada ruta con `tarifa_referencia` NOT NULL que todavía no
--      tenga ninguna fila en `tms_ruta_tarifas`, se inserta una "Tarifa
--      base" (predeterminada = 1, activa = 1) — así las rutas existentes
--      quedan listas para el multi-tarifario sin captura manual.

-- 1. Catálogo de opciones de tarifa por ruta.
CREATE TABLE IF NOT EXISTS tms_ruta_tarifas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  descripcion VARCHAR(300) NULL,
  monto DECIMAL(12,2) NOT NULL,
  moneda VARCHAR(10) NOT NULL DEFAULT 'GTQ',
  vigente_desde DATE NOT NULL,
  vigente_hasta DATE NULL DEFAULT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  predeterminada TINYINT(1) NOT NULL DEFAULT 0,
  observacion VARCHAR(300) NULL,
  creado_por INT NULL,
  creado_por_nombre VARCHAR(200) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_por INT NULL,
  actualizado_por_nombre VARCHAR(200) NULL,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tmsrutatarifas_ruta (empresa_id, ruta_id, activa, predeterminada),
  CONSTRAINT fk_tmsrutatarifas_empresa
    FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsrutatarifas_ruta_ambito
    FOREIGN KEY (empresa_id, ruta_id) REFERENCES tms_cliente_rutas (empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsrutatarifas_creador
    FOREIGN KEY (creado_por) REFERENCES usuarios (id) ON DELETE SET NULL,
  CONSTRAINT fk_tmsrutatarifas_editor
    FOREIGN KEY (actualizado_por) REFERENCES usuarios (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Unidad recurrente / habitual de la ruta (opcional).
ALTER TABLE tms_cliente_rutas
  ADD COLUMN IF NOT EXISTS unidad_recurrente_id INT NULL DEFAULT NULL AFTER costo_operativo;

-- FK SIMPLE a flota_vehiculos(id) — mismo patrón que fk_tmsuni_flota
-- (tms_unidades.flota_vehiculo_id), YA probado en producción. NO
-- compuesta: evita el errno 150 por desajuste de tipo entre
-- tms_cliente_rutas.empresa_id y flota_vehiculos.empresa_id. Se detecta
-- por nombre de constraint para ser reejecutable (la migración ya corrió
-- parcialmente: la columna existe, la FK no).
SET @ur_fk_ddl = IF(EXISTS (
  SELECT 1 FROM information_schema.table_constraints
  WHERE table_schema = DATABASE() AND table_name = 'tms_cliente_rutas'
    AND constraint_name = 'fk_tmsclirutas_unidad_recurrente'
), 'SELECT 1',
  'ALTER TABLE tms_cliente_rutas
     ADD CONSTRAINT fk_tmsclirutas_unidad_recurrente
     FOREIGN KEY (unidad_recurrente_id)
     REFERENCES flota_vehiculos (id) ON DELETE SET NULL');
PREPARE ur_fk_stmt FROM @ur_fk_ddl;
EXECUTE ur_fk_stmt;
DEALLOCATE PREPARE ur_fk_stmt;

-- 3. Snapshot de la tarifa usada en cada viaje.
ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS tarifa_id INT NULL DEFAULT NULL AFTER tarifa_comercial,
  ADD COLUMN IF NOT EXISTS tarifa_nombre_historico VARCHAR(120) NULL DEFAULT NULL AFTER tarifa_id,
  ADD COLUMN IF NOT EXISTS tarifa_monto_historico DECIMAL(12,2) NULL DEFAULT NULL AFTER tarifa_nombre_historico,
  ADD COLUMN IF NOT EXISTS tarifa_moneda_historico VARCHAR(10) NULL DEFAULT NULL AFTER tarifa_monto_historico;

-- 4. Seed: "Tarifa base" para rutas que hoy ya tienen tarifa_referencia
--    y aún no tienen ninguna opción en el catálogo nuevo. Reejecutable
--    (el NOT EXISTS evita duplicar en una segunda corrida).
INSERT INTO tms_ruta_tarifas
  (empresa_id, ruta_id, nombre, descripcion, monto, moneda, vigente_desde, activa, predeterminada, observacion)
SELECT r.empresa_id, r.id, 'Tarifa base', 'Tarifa creada automáticamente desde la tarifa de referencia de la ruta.',
       r.tarifa_referencia, 'GTQ', CURDATE(), 1, 1,
       'Sembrada por migrate-2026-09-rutas-tarifario-multiple-unidad.sql'
FROM tms_cliente_rutas r
WHERE r.tarifa_referencia IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM tms_ruta_tarifas t WHERE t.ruta_id = r.id);

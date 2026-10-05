-- PROPUESTA: NO ejecutada. MariaDB 11.8.9. Ejecutar PRIMERO sql/preflight-2026-10-cotizaciones-historial-costeos.sql.
-- COTIZACIONES — HISTORIAL DE COSTEOS: pasa de 1 cotización -> 1 costeo a 1 cotización -> N versiones de costeo, cada una INMUTABLE.
--
-- Qué cambia en tms_cotizacion_costeos (los snapshots JSON, los importes y los componentes NO se tocan):
--   version           INT NOT NULL            número de versión por cotización (1, 2, 3...). La app la asigna con la cotización padre bloqueada.
--   es_seleccionado   TINYINT(1) NOT NULL 0   1 = versión «utilizada». A lo sumo UNA por cotización: MariaDB no tiene índice parcial; la unicidad la
--                                             garantiza la aplicación dentro de una transacción (SELECT ... FOR UPDATE sobre la cotización y sus costeos).
--   seleccionado_por  VARCHAR(100) NULL       quién eligió esa versión (NULL en los históricos migrados: no se conoce).
--   seleccionado_en   DATETIME NULL           cuándo (NULL en los históricos migrados).
--   uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id)             -> SE ELIMINA (era lo que forzaba el 1:1)
--   uq_cotizacion_costeo_version    (empresa_id, cotizacion_id, version)    -> NUEVO, único
--   idx_cotizacion_costeo_historial (empresa_id, cotizacion_id, creado_en)  -> NUEVO, consulta del historial
--
-- Históricos: hoy cada cotización tiene como máximo UN costeo (lo imponía el índice único viejo), así que cada fila existente es su versión 1 y
-- era el único costeo de su cotización => version = 1 y es_seleccionado = 1. Sin recalcular nada.
-- El UPDATE solo toca filas con version IS NULL: re-ejecutar la migración NO vuelve a marcar como seleccionadas versiones posteriores.
-- Orden: (1) columnas (2) históricos (3) version NOT NULL (4) índices nuevos (5) soltar el índice viejo. El índice nuevo se crea ANTES de soltar el
-- viejo porque la FK compuesta fk_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id) necesita un índice con esas columnas al frente.
-- VENTANA: entre aplicar esta migración y desplegar el código nuevo, el código anterior NO puede registrar costeos (version es NOT NULL sin default).
-- Aplicar la migración y desplegar seguido; el código nuevo exige estas columnas e índices.

-- 1) Columnas (version nullable solo mientras se rellenan los históricos)
ALTER TABLE tms_cotizacion_costeos
  ADD COLUMN IF NOT EXISTS version INT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS es_seleccionado TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS seleccionado_por VARCHAR(100) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS seleccionado_en DATETIME NULL DEFAULT NULL;

-- 2) Históricos existentes = versión 1 seleccionada (idempotente: solo filas aún sin versión)
UPDATE tms_cotizacion_costeos SET version = 1, es_seleccionado = 1 WHERE version IS NULL;

-- 3) version obligatoria
ALTER TABLE tms_cotizacion_costeos MODIFY COLUMN version INT NOT NULL;

-- 4) Índices nuevos (antes de soltar el viejo)
ALTER TABLE tms_cotizacion_costeos
  ADD UNIQUE KEY IF NOT EXISTS uq_cotizacion_costeo_version (empresa_id, cotizacion_id, version),
  ADD INDEX IF NOT EXISTS idx_cotizacion_costeo_historial (empresa_id, cotizacion_id, creado_en);

-- 5) Soltar SOLO el índice único que forzaba 1 costeo por cotización
ALTER TABLE tms_cotizacion_costeos DROP INDEX IF EXISTS uq_cotizacion_costeo_cotizacion;

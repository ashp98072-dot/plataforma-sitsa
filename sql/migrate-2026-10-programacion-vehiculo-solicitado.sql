-- PROGRAMACION-VEHICULO-SOLICITADO — "Vehículo solicitado por el cliente" por viaje.
-- Expansión ADITIVA. NO se ejecuta automáticamente: aplicar manualmente en phpMyAdmin
-- DESPUÉS de sql/preflight-2026-10-programacion-vehiculo-solicitado.sql y ANTES del despliegue.
-- Sin backfill: los viajes existentes quedan con NULL y se muestran como "—" (nunca se
-- infiere lo solicitado desde la unidad usada: 5 t usada puede corresponder a 2.5 t solicitada).
-- No hace DROP, DELETE, TRUNCATE ni UPDATE.
--
-- MODELO (el dato pertenece al VIAJE, no al vehículo físico)
--   tms_planes_viaje.vehiculo_solicitado_perfil_id  INT NULL
--     Catálogo REUTILIZADO: tms_cotizacion_costeo_perfiles (tipos/capacidades de vehículo
--     por empresa que ya usa Cotizaciones). FK COMPUESTA (empresa_id, perfil) para que un
--     viaje nunca apunte al perfil de otra empresa. NULL = sin dato (viajes históricos).
--   tms_planes_viaje.vehiculo_solicitado_nombre     VARCHAR(120) NULL
--     Fotografía del nombre del perfil al elegirlo (mismo criterio que
--     tarifa_nombre_historico / tc_placa_historica): si el perfil se renombra o desactiva,
--     el viaje conserva lo que se solicitó.
--   Independiente de unidad_id / tc_* / tarifa_comercial: cambiar uno NO cambia los otros.
--
-- Idempotente en MariaDB (IF NOT EXISTS en columnas, índice y FK). La FK es RESTRICT: los
-- perfiles de costeo no se borran (se desactivan), y un perfil en uso no debe desaparecer.
SET NAMES utf8mb4;

ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS vehiculo_solicitado_perfil_id INT NULL AFTER tc_externo_placa,
  ADD COLUMN IF NOT EXISTS vehiculo_solicitado_nombre VARCHAR(120) NULL AFTER vehiculo_solicitado_perfil_id;

ALTER TABLE tms_planes_viaje
  ADD INDEX IF NOT EXISTS idx_tmsplan_vehiculo_solicitado (empresa_id, vehiculo_solicitado_perfil_id);

ALTER TABLE tms_planes_viaje
  ADD CONSTRAINT fk_tmsplan_vehiculo_solicitado FOREIGN KEY IF NOT EXISTS (empresa_id, vehiculo_solicitado_perfil_id)
  REFERENCES tms_cotizacion_costeo_perfiles(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;

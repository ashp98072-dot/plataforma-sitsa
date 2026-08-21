-- Fase A1 del plan "Programación SITSA": vínculo estructural entre
-- tms_unidades (TMS) y flota_vehiculos (Flota). Solo agrega la columna,
-- el índice y la FK — NO hace backfill de datos (ver Fase A3, archivo
-- aparte: migrate-2026-08-fase-a3-backfill-tms-unidades-flota.sql).
--
-- flota_vehiculo_id queda NULL para todas las filas existentes. Nada en
-- el código lee ni escribe esta columna todavía: el sistema sigue
-- resolviendo el vehículo por texto de placa exactamente igual que hoy
-- (vehiculoPorPlaca en src/lib/flota/pilotos.ts). Es un cambio
-- estructural sin efecto funcional observable hasta una fase futura (A4)
-- que aún no está autorizada.
--
-- Seguro para re-ejecutar UNA vez contra una base que no la tenga
-- todavía; si se re-ejecuta después de aplicada, MySQL fallará con
-- "Duplicate column name" / "Duplicate key name" / FK ya existente
-- (no corrompe nada, solo hay que no repetirlo sin revisar antes).
--
-- REVISAR ANTES DE EJECUTAR EN phpMyAdmin. No lo ejecuta Claude.

SET NAMES utf8mb4;

ALTER TABLE tms_unidades
  ADD COLUMN flota_vehiculo_id INT NULL AFTER placa;

ALTER TABLE tms_unidades
  ADD INDEX idx_tmsuni_flota (flota_vehiculo_id);

ALTER TABLE tms_unidades
  ADD CONSTRAINT fk_tmsuni_flota
  FOREIGN KEY (flota_vehiculo_id) REFERENCES flota_vehiculos(id)
  ON DELETE SET NULL;

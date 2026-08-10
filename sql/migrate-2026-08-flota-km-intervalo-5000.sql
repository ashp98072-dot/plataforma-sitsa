-- Intervalo de servicio por defecto: 5 000 km (no reescribe unidades existentes).
SET NAMES utf8mb4;

ALTER TABLE flota_vehiculos
  MODIFY COLUMN km_intervalo_servicio INT NOT NULL DEFAULT 5000;

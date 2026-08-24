-- Configuración aditiva para unidades sin odómetro funcional.
-- No elimina ni modifica historiales de viajes, lecturas o servicios.
-- Idempotente en MySQL 8+; ejecutar manualmente antes de desplegar el código.

ALTER TABLE flota_vehiculos
  ADD COLUMN IF NOT EXISTS odometro_funcional TINYINT(1) NOT NULL DEFAULT 1 AFTER fecha_ultimo_servicio,
  ADD COLUMN IF NOT EXISTS mantenimiento_intervalo_meses SMALLINT NULL AFTER odometro_funcional;

-- Una unidad sin odómetro guarda NULL en salida/llegada. Las unidades existentes
-- conservan odometro_funcional = 1 y continúan con el flujo actual.
ALTER TABLE flota_viajes
  MODIFY COLUMN km_salida INT NULL;

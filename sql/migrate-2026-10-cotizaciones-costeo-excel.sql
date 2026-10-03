-- PROPUESTA: NO ejecutada. MariaDB 11.8.9. Ejecutar preflight y revisar definiciones primero.
-- Aditiva e idempotente; NULL preserva datos existentes. No transforma snapshots ni siembra perfiles.
ALTER TABLE tms_cotizacion_costeo_parametros
  ADD COLUMN IF NOT EXISTS seguro_mercaderia_anual DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cantidad_camiones INT NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS viajes_anuales DECIMAL(10,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dias_depreciacion_mes DECIMAL(5,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dias_gastos_mes DECIMAL(5,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gastos_administracion DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gastos_mantenimiento DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gastos_seguridad DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gastos_predios DECIMAL(14,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS salario_piloto_mensual DECIMAL(12,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS salario_auxiliar_mensual DECIMAL(12,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dias_laborales_mes DECIMAL(5,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS margen2 DECIMAL(10,6) NULL DEFAULT NULL;

ALTER TABLE tms_cotizacion_costeo_perfiles
  ADD COLUMN IF NOT EXISTS viajes_mes DECIMAL(10,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS precio_llanta DECIMAL(12,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cantidad_llantas INT NULL DEFAULT NULL;

ALTER TABLE tms_cotizacion_costeos
  ADD COLUMN IF NOT EXISTS resultado_snapshot JSON NULL DEFAULT NULL;

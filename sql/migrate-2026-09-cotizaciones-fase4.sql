-- COTIZACIONES FASE 4. MariaDB 11.8 / InnoDB / utf8mb4.
-- Migración aditiva e idempotente. NO fue ejecutada por este PR.
ALTER TABLE tms_cliente_rutas
  ADD COLUMN IF NOT EXISTS servicio_refrigerado_habitual TINYINT(1) NOT NULL DEFAULT 0
  AFTER tarifa_referencia;

ALTER TABLE tms_cotizaciones
  ADD COLUMN IF NOT EXISTS servicio_refrigerado TINYINT(1) NOT NULL DEFAULT 0
  AFTER seguro_terceros_incluido;

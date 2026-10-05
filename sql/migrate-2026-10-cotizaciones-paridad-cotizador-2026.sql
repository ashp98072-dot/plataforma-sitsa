-- PROPUESTA: NO ejecutada. MariaDB 11.8.9. Ejecutar PRIMERO sql/preflight-2026-10-cotizaciones-paridad-cotizador-2026.sql.
-- Posterior a la migración del PR #406 (sql/migrate-2026-10-cotizaciones-costeo-excel.sql, ya aplicada): NO la modifica ni la revierte.
-- Aditiva e idempotente: una sola columna NULL DEFAULT NULL. NULL = "sin configurar" (no se inventa un monto).
-- Sin UPDATE, sin seeds, sin cambios de FK/índices, sin tocar snapshots ni perfiles existentes.
ALTER TABLE tms_cotizacion_costeo_perfiles
  ADD COLUMN IF NOT EXISTS viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL;

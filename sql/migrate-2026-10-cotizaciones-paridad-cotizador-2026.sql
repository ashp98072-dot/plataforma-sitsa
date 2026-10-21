-- PROPUESTA: NO ejecutada. MariaDB 11.8.9. Ejecutar PRIMERO sql/preflight-2026-10-cotizaciones-paridad-cotizador-2026.sql.
-- Posterior a la migración del PR #406 (sql/migrate-2026-10-cotizaciones-costeo-excel.sql, ya aplicada): NO la modifica ni la revierte.
-- Aditiva e idempotente: tres columnas NULL DEFAULT NULL en los perfiles de unidad. NULL = "sin configurar" (no se inventa un valor).
--   viaticos_hotel_viaje            valor predeterminado de «Viáticos y hotel» por viaje (la columna única del libro).
--   auxiliar_multiplica_dias        1 = el auxiliar se cobra por cada día de servicio; 0 = una sola vez (según la hoja fuente).
--   viaticos_hotel_multiplica_dias  1 = «Viáticos y hotel» del perfil se cobra por cada día; 0 = una sola vez (según la hoja fuente).
-- Sin UPDATE, sin seeds (los valores de referencia de cada hoja se configuran desde Ajustes), sin cambios de FK/índices, sin tocar snapshots.
ALTER TABLE tms_cotizacion_costeo_perfiles
  ADD COLUMN IF NOT EXISTS viaticos_hotel_viaje DECIMAL(12,2) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS auxiliar_multiplica_dias TINYINT(1) NULL DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS viaticos_hotel_multiplica_dias TINYINT(1) NULL DEFAULT NULL;

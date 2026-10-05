-- SOLO LECTURA. Seleccionar explícitamente la BD de destino en phpMyAdmin.
-- Prerrequisito: la migración del PR #406 (sql/migrate-2026-10-cotizaciones-costeo-excel.sql) YA aplicada.
-- APLICAR: la tabla de perfiles existe, trae las columnas del PR #406 y viaticos_hotel_viaje está AUSENTE.
-- NOOP: viaticos_hotel_viaje ya existe como DECIMAL(12,2) NULL DEFAULT NULL.
-- DETENER: faltan columnas del PR #406, la tabla no existe, o viaticos_hotel_viaje existe con otro tipo/null/default
--          (ADD COLUMN IF NOT EXISTS NO repara una definición incompatible).
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;
-- Columnas del PR #406 que deben existir (las 5 filas deben aparecer):
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'viajes_mes';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'precio_llanta';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'cantidad_llantas';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'salario_piloto_mensual';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'salario_auxiliar_mensual';
-- Columna nueva: 0 filas = APLICAR; 1 fila = revisar Type=decimal(12,2), Null=YES, Default=NULL (NOOP si coincide).
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'viaticos_hotel_viaje';
-- Las tablas de snapshots NO cambian: confirmar solo que siguen presentes.
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'resultado_snapshot';

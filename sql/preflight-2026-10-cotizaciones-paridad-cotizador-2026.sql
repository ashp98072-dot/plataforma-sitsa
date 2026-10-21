-- SOLO LECTURA. Seleccionar explícitamente la BD de destino en phpMyAdmin.
-- Prerrequisito: la migración del PR #406 (sql/migrate-2026-10-cotizaciones-costeo-excel.sql) YA aplicada.
-- APLICAR: la tabla de perfiles existe, trae las columnas del PR #406 y las TRES columnas nuevas están AUSENTES.
-- NOOP: las tres existen con la definición de la migración (ver abajo).
-- DETENER: faltan columnas del PR #406, la tabla no existe, o alguna columna nueva existe con otro tipo/null/default
--          (ADD COLUMN IF NOT EXISTS NO repara una definición incompatible), o hay solo algunas de las tres (revisar antes de aplicar).
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;
-- Columnas del PR #406 que deben existir (las 5 filas deben aparecer):
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'viajes_mes';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'precio_llanta';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'cantidad_llantas';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'salario_piloto_mensual';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'salario_auxiliar_mensual';
-- Columnas nuevas: 0 filas en las tres = APLICAR. Si aparecen, revisar la definición esperada:
--   viaticos_hotel_viaje            decimal(12,2)  Null=YES  Default=NULL
--   auxiliar_multiplica_dias        tinyint(1)     Null=YES  Default=NULL
--   viaticos_hotel_multiplica_dias  tinyint(1)     Null=YES  Default=NULL
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'viaticos_hotel_viaje';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'auxiliar_multiplica_dias';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'viaticos_hotel_multiplica_dias';
-- Las tablas de snapshots NO cambian: confirmar solo que siguen presentes.
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'resultado_snapshot';

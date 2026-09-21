-- COTIZACIONES-COSTEO (Fase 3) — preflight SOLO LECTURA. No ejecutado por este PR.
--
-- Producción KT fue aplicada manualmente antes de versionar la migración
-- (sql/migrate-2026-09-cotizaciones-costeo.sql). Este preflight sirve para
-- comparar una base contra el esquema canónico.
--
-- HOSTINGER: el usuario de producción NO tiene acceso suficiente a
-- information_schema, así que aquí SOLO se usan SHOW ... y SELECT sobre las
-- propias tablas. Nada de information_schema.TABLES/STATISTICS/
-- REFERENTIAL_CONSTRAINTS. SHOW opera sobre la base ACTIVA: selecciónala
-- antes en phpMyAdmin y confirma con el primer SELECT de abajo.
--
-- Cómo leerlo (revisión manual, no hay CASE automático):
--   APLICAR = alguna de las 4 tablas o el índice NO existe -> ejecutar la migración.
--   NOOP    = las 4 tablas y el índice existen y SHOW CREATE TABLE coincide con schema.sql.
--   DETENER = existen pero difieren (tipos/índices/FKs) -> revisar a mano, NO aplicar a ciegas.

SELECT VERSION() AS version_servidor, DATABASE() AS base_activa;

-- 1) Tablas (cada SHOW debe devolver 1 fila si existe, 0 si falta).
SHOW TABLES LIKE 'tms_cotizaciones';
SHOW TABLES LIKE 'tms_cotizacion_costeo_perfiles';
SHOW TABLES LIKE 'tms_cotizacion_costeo_parametros';
SHOW TABLES LIKE 'tms_cotizacion_costeos';
SHOW TABLES LIKE 'tms_cotizacion_costeo_componentes';

-- 2) Índice único requerido en tms_cotizaciones. Buscar la key
--    uq_cotizacion_empresa_id con Non_unique = 0 y columnas, en orden:
--    Seq_in_index 1 = empresa_id, Seq_in_index 2 = id.
SHOW INDEX FROM tms_cotizaciones;

-- 3) Definición completa de las 4 tablas (comparar con sql/schema.sql:
--    tipos DECIMAL, índices únicos, FKs compuestas, ENGINE=InnoDB utf8mb4).
SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;
SHOW CREATE TABLE tms_cotizacion_costeo_parametros;
SHOW CREATE TABLE tms_cotizacion_costeos;
SHOW CREATE TABLE tms_cotizacion_costeo_componentes;

-- 4) Configuración cargada (informativo; solo conteos, sin valores de negocio).
SELECT empresa_id, COUNT(*) AS perfiles, SUM(activo = 1) AS perfiles_activos
FROM tms_cotizacion_costeo_perfiles GROUP BY empresa_id;
SELECT empresa_id, COUNT(*) AS vigencias, MIN(vigente_desde) AS desde, MAX(vigente_desde) AS hasta
FROM tms_cotizacion_costeo_parametros GROUP BY empresa_id;

-- 5) Snapshots existentes (informativo): 0 antes del primer uso de la Fase 3.
SELECT COUNT(*) AS snapshots FROM tms_cotizacion_costeos;

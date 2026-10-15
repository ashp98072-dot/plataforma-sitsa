-- SOLO LECTURA. Seleccionar la BD objetivo. Revisar TODO antes de autorizar migrate.
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE compras_proveedores;
SHOW CREATE TABLE flota_combustible_cargas;
SHOW FULL COLUMNS FROM flota_combustible_cargas;
SHOW INDEX FROM flota_combustible_cargas;
SHOW TABLE STATUS LIKE 'compras_proveedores';
SHOW TABLE STATUS LIKE 'flota_combustible_cargas';
SHOW TABLES LIKE 'flota_combustible_estaciones';
SELECT COUNT(*) AS vales, MIN(id) AS primer_id, MAX(id) AS ultimo_id,
 SUM(gasolinera IS NOT NULL AND TRIM(gasolinera)<>'') AS con_texto_historico
FROM flota_combustible_cargas;
-- APLICAR: C-1 verificado; INT signed para IDs; padres InnoDB;
-- compras_proveedores tiene UNIQUE(empresa_id,id); no tabla estaciones ni estacion_id.
-- NOOP: tabla/columna/índice/FK ya tienen exactamente el contrato de migrate.
-- Si la tabla estaciones ya existe, revisar además SHOW CREATE TABLE flota_combustible_estaciones.
-- DETENER: tipos/engine distintos, nombres de FK ocupados por otra definición, o estado parcial no explicado.
-- No deducir estaciones a partir del texto; no se cambia gasolinera ni se hace backfill.

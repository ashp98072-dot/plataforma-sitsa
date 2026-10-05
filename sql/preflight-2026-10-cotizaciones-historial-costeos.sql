-- SOLO LECTURA. Seleccionar explícitamente la BD de destino en phpMyAdmin.
-- Prerrequisito: migraciones de costeo anteriores (2026-09 y 2026-10) ya aplicadas: la tabla tms_cotizacion_costeos existe.
-- APLICAR: las 4 columnas nuevas están AUSENTES, existe uq_cotizacion_costeo_cotizacion y NO hay cotizaciones con más de un costeo.
-- NOOP: las 4 columnas existen con la definición esperada (ver abajo), existe uq_cotizacion_costeo_version, existe idx_cotizacion_costeo_historial
--       y NO existe uq_cotizacion_costeo_cotizacion.
-- DETENER: la tabla no existe; hay cotizaciones con más de un costeo (no debería ser posible por el índice único viejo: investigar antes de migrar);
--          una columna nueva existe con otra definición (ADD COLUMN IF NOT EXISTS no la repara); o el estado es mixto (algunas columnas/índices sí y otros no).
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE tms_cotizacion_costeos;
-- Índices actuales. Debe aparecer uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id) antes de migrar:
SHOW INDEX FROM tms_cotizacion_costeos;
-- Columnas nuevas: 0 filas en las cuatro = APLICAR. Si aparecen, definición esperada:
--   version           int(11)       Null=NO   Default=1   (tras la migración; NULL solo mientras se rellenan los históricos)
--   es_seleccionado   tinyint(1)    Null=NO   Default=0
--   seleccionado_por  varchar(100)  Null=YES  Default=NULL
--   seleccionado_en   datetime      Null=YES  Default=NULL
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'version';
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'es_seleccionado';
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'seleccionado_por';
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'seleccionado_en';
-- Cantidad de costeos existentes (todos pasarán a version = 1, es_seleccionado = 1):
SELECT COUNT(*) AS total_costeos FROM tms_cotizacion_costeos;
-- Cotizaciones con más de un costeo ANTES de migrar: debe devolver 0.
SELECT COUNT(*) AS cotizaciones_con_mas_de_un_costeo FROM (SELECT 1 FROM tms_cotizacion_costeos GROUP BY empresa_id, cotizacion_id HAVING COUNT(*) > 1) t;
-- Verificación posterior a la migración (volver a ejecutar este archivo): version sin NULL, una sola versión seleccionada por cotización
-- y todos los históricos en versión 1 seleccionada. Las dos consultas siguientes deben devolver 0 en ambos casos:
SELECT COUNT(*) AS costeos_sin_version FROM tms_cotizacion_costeos WHERE version IS NULL;
SELECT COUNT(*) AS cotizaciones_con_mas_de_un_seleccionado FROM (SELECT 1 FROM tms_cotizacion_costeos WHERE es_seleccionado = 1 GROUP BY empresa_id, cotizacion_id HAVING COUNT(*) > 1) t;
-- Costeos registrados por el código ANTERIOR durante la transición SQL -> deploy (version = 1 por default, es_seleccionado = 0): cotizaciones con costeos y
-- ninguno seleccionado. Debe devolver 0 tras el deploy; si no, la versión 1 de esas cotizaciones debe marcarse como seleccionada (es el único costeo que el
-- código anterior permite por cotización). Reparación, SOLO tras revisar el conteo y con autorización:
--   UPDATE tms_cotizacion_costeos SET es_seleccionado = 1 WHERE version = 1 AND cotizacion_id IN (...ids revisados...) ;
SELECT COUNT(*) AS cotizaciones_con_costeos_sin_seleccionado FROM (SELECT 1 FROM tms_cotizacion_costeos GROUP BY empresa_id, cotizacion_id HAVING SUM(es_seleccionado) = 0) t;
-- Las tablas de componentes NO cambian: confirmar solo que siguen presentes.
SHOW TABLES LIKE 'tms_cotizacion_costeo_componentes';

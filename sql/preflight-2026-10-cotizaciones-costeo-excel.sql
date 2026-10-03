-- SOLO LECTURA. Seleccionar explícitamente la BD de destino en phpMyAdmin.
-- APLICAR: tablas actuales compatibles y todas las columnas nuevas ausentes.
-- NOOP: todas presentes con la definición de la migración (JSON puede ser LONGTEXT con CHECK JSON_VALID en MariaDB).
-- DETENER: mezcla parcial, tipos distintos, tablas ausentes o versión no compatible.
-- Revisar Column Type/Null/Default manualmente; IF NOT EXISTS NO repara definiciones incompatibles.
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE tms_cotizacion_costeo_parametros;
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'seguro_mercaderia_anual';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'cantidad_camiones';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'viajes_anuales';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'dias_depreciacion_mes';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'dias_gastos_mes';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'gastos_administracion';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'gastos_mantenimiento';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'gastos_seguridad';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'gastos_predios';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'salario_piloto_mensual';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'salario_auxiliar_mensual';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'dias_laborales_mes';
SHOW COLUMNS FROM tms_cotizacion_costeo_parametros LIKE 'margen2';

SHOW CREATE TABLE tms_cotizacion_costeo_perfiles;
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'viajes_mes';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'precio_llanta';
SHOW COLUMNS FROM tms_cotizacion_costeo_perfiles LIKE 'cantidad_llantas';

SHOW CREATE TABLE tms_cotizacion_costeos;
SHOW COLUMNS FROM tms_cotizacion_costeos LIKE 'resultado_snapshot';
-- Confirmar definición física DECIMAL/INT/JSON de todos los campos antes de autorizar.

-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de
-- Hostinger. Ejecutar seleccionando primero la base de la plataforma.
-- No consulta tablas de metadatos del sistema (producción no las permite)
-- ni intenta automatizar una decisión que dependa de permisos que
-- producción no concede.
--
-- Interpretación del resultado de SHOW TABLES:
--   APLICAR: cero filas (la tabla no existe todavía). Ejecutar
--            sql/migrate-2026-09-cotizaciones-lineas.sql.
--   NOOP:    una fila. Revisar con SHOW CREATE TABLE que la definición
--            coincide con la de la migración (mismas columnas, mismas
--            claves, mismas FK) antes de asumir que ya está aplicada.
--   DETENER: cualquier otro resultado, o el SHOW CREATE TABLE no coincide
--            con lo esperado — no ejecutar la migración, revisar primero.

SHOW TABLES LIKE 'tms_cotizacion_lineas';

-- Si la fila anterior existe, revisar la definición completa:
-- SHOW CREATE TABLE tms_cotizacion_lineas;

-- Confirmación de que tms_cotizaciones sigue teniendo la forma que esta
-- migración asume como "línea principal" (no se modifica, solo se referencia
-- por FK compuesta empresa_id+id — debe existir esa combinación como clave
-- única/candidata, ya presente desde el esquema original de la tabla):
SHOW CREATE TABLE tms_cotizaciones;

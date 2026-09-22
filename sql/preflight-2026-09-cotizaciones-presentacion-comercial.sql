-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de
-- Hostinger. Ejecutar seleccionando primero la base de la plataforma.
-- No consulta metadatos del sistema (producción no lo permite) ni intenta
-- automatizar una decisión que dependa de permisos que producción no concede.
--
-- Definición esperada de las dos columnas de tms_cotizaciones
-- (columnas Type / Null / Default del resultado de SHOW COLUMNS):
--   mensaje_comercial   text   YES   NULL
--   cierre_comercial    text   YES   NULL
--
-- Interpretación conjunta de los dos primeros resultados:
--   APLICAR: las dos devuelven cero filas. Ejecutar
--            sql/migrate-2026-09-cotizaciones-presentacion-comercial.sql.
--   NOOP:    las dos devuelven una fila con exactamente la definición esperada.
--            La migración ya está aplicada: no ejecutar nada.
--   DETENER: estado parcial (solo una columna existe) o alguna columna con
--            una definición distinta (otro tipo, longitud, nulabilidad o
--            default). No ejecutar la migración: revisar primero con el
--            SHOW CREATE TABLE.
--
-- No requiere preflight de la tabla `configuracion`: ya existe en producción
-- (migrate-2026-08-rrhh-core.sql, en uso por RRHH) y los mensajes por marca
-- solo agregan filas nuevas ahí (parametro distinto), sin tocar su esquema.
--
-- El SHOW CREATE es respaldo opcional para revisar posición y DDL completo;
-- tampoco escribe ni altera datos.

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'mensaje_comercial';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'cierre_comercial';

SHOW CREATE TABLE tms_cotizaciones;

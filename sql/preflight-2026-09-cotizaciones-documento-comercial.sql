-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de
-- Hostinger. Ejecutar seleccionando primero la base de la plataforma.
-- No consulta metadatos del sistema (producción no lo permite) ni intenta
-- automatizar una decisión que dependa de permisos que producción no concede.
--
-- Definición esperada de las cuatro columnas de tms_cotizaciones
-- (columnas Type / Null / Default del resultado de SHOW COLUMNS):
--   documento_emisor    varchar(20)   NO    KUIQTRANS
--   atencion_nombre     varchar(160)  YES   NULL
--   atencion_cargo      varchar(160)  YES   NULL
--   unidad_descripcion  varchar(160)  YES   NULL
--
-- Interpretación conjunta de los cuatro primeros resultados:
--   APLICAR: los cuatro devuelven cero filas. Ejecutar
--            sql/migrate-2026-09-cotizaciones-documento-comercial.sql.
--   NOOP:    los cuatro devuelven una fila con exactamente la definición esperada.
--            La migración ya está aplicada: no ejecutar nada.
--   DETENER: estado parcial (solo algunas columnas existen) o alguna columna con
--            una definición distinta (otro tipo, longitud, nulabilidad o default).
--            No ejecutar la migración: revisar primero con el SHOW CREATE TABLE.
--
-- El SHOW CREATE es respaldo opcional para revisar posición y DDL completo;
-- tampoco escribe ni altera datos.

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'documento_emisor';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'atencion_nombre';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'atencion_cargo';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'unidad_descripcion';

SHOW CREATE TABLE tms_cotizaciones;

-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de
-- Hostinger. Ejecutar seleccionando primero la base de la plataforma.
-- No consulta metadatos del sistema (producción no lo permite) — mismo criterio que
-- sql/preflight-2026-09-cotizaciones-presentacion-comercial.sql.
--
-- Definición esperada de las tres columnas de tms_cotizaciones
-- (columnas Type / Null / Default del resultado de SHOW COLUMNS):
--   condiciones_credito             varchar(300)    YES   NULL
--   combustible_referencia_tipo     varchar(20)     YES   NULL
--   combustible_referencia_precio   decimal(12,2)   YES   NULL
--
-- La migración las coloca después de cierre_comercial: el cuarto resultado debe
-- devolver esa columna (si no existe, DETENER: falta una migración previa).
--
-- Interpretación conjunta de los tres primeros resultados:
--   APLICAR: los tres devuelven cero filas. Ejecutar
--            sql/migrate-2026-10-cotizaciones-credito-combustible.sql.
--   NOOP:    los tres devuelven una fila con exactamente la definición esperada.
--            La migración ya está aplicada: no ejecutar nada.
--   DETENER: estado parcial (solo alguna columna existe) o alguna columna con
--            una definición distinta (otro tipo, longitud, nulabilidad o
--            default). No ejecutar la migración: revisar primero con el
--            SHOW CREATE TABLE.
--
-- El SHOW CREATE es respaldo opcional para revisar posición y DDL completo;
-- tampoco escribe ni altera datos.

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'condiciones_credito';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'combustible_referencia_tipo';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'combustible_referencia_precio';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'cierre_comercial';

SHOW CREATE TABLE tms_cotizaciones;

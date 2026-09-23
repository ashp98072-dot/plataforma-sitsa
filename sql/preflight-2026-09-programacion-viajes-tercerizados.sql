-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de
-- Hostinger. Ejecutar seleccionando primero la base de la plataforma.
-- No consulta tablas de metadatos del sistema (producción no las permite)
-- ni intenta automatizar una decisión que dependa de permisos que
-- producción no concede.
--
-- Definición esperada de las 7 columnas de tms_planes_viaje (columnas
-- Type / Null / Default del resultado de SHOW COLUMNS):
--   tipo_viaje                   varchar(20)   NO    Propio
--   piloto_externo_nombre        varchar(160)  YES   NULL
--   auxiliares_externos          text          YES   NULL
--   unidad_externa_placa         varchar(40)   YES   NULL
--   unidad_externa_descripcion   varchar(160)  YES   NULL
--   transportista_externo        varchar(160)  YES   NULL
--   costo_tercerizado            decimal(12,2) YES   NULL
--
-- Interpretación conjunta de los 7 resultados:
--   APLICAR: las 7 devuelven cero filas. Ejecutar
--            sql/migrate-2026-09-programacion-viajes-tercerizados.sql.
--   NOOP:    las 7 devuelven una fila con exactamente la definición
--            esperada. La migración ya está aplicada: no ejecutar nada.
--   DETENER: estado parcial (solo alguna de las 7 existe) o alguna
--            columna con una definición distinta (otro tipo, longitud,
--            nulabilidad o default). No ejecutar la migración: revisar
--            primero con el SHOW CREATE TABLE.

SHOW COLUMNS FROM tms_planes_viaje LIKE 'tipo_viaje';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'piloto_externo_nombre';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'auxiliares_externos';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'unidad_externa_placa';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'unidad_externa_descripcion';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'transportista_externo';
SHOW COLUMNS FROM tms_planes_viaje LIKE 'costo_tercerizado';

-- Respaldo opcional para revisar posición y DDL completo; tampoco escribe ni altera datos.
SHOW CREATE TABLE tms_planes_viaje;

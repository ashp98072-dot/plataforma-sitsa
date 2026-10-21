-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de Hostinger.
-- Ejecutar seleccionando primero la base de la plataforma. No consulta metadatos del sistema.
--
-- Definición esperada (columnas Type / Null / Default de SHOW COLUMNS):
--   atencion_tratamiento   varchar(10)   YES   NULL
--
--   APLICAR: el primer resultado devuelve cero filas. Ejecutar
--            sql/migrate-2026-10-cotizaciones-tratamiento-destinatario.sql.
--   NOOP:    devuelve una fila con exactamente esa definición: ya está aplicada, no ejecutar nada.
--   DETENER: la columna existe con otra definición. Revisar con el SHOW CREATE TABLE.
-- El segundo resultado debe devolver atencion_nombre (la migración coloca la columna después de ella); si no
-- existe, DETENER: falta la migración documento-comercial.

SHOW COLUMNS FROM tms_cotizaciones LIKE 'atencion_tratamiento';
SHOW COLUMNS FROM tms_cotizaciones LIKE 'atencion_nombre';
SHOW CREATE TABLE tms_cotizaciones;

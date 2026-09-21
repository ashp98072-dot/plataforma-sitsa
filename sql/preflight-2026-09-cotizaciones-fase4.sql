-- PREFLIGHT MANUAL, SOLO LECTURA, compatible con el usuario restringido de
-- Hostinger. Ejecutar seleccionando primero la base de la plataforma.
-- No consulta metadatos del sistema ni intenta automatizar una decisión que
-- dependa de permisos que producción no concede.
--
-- Interpretación conjunta de los dos primeros resultados:
--   APLICAR: ambos devuelven cero filas.
--   NOOP: ambos devuelven exactamente Type=tinyint(1), Null=NO, Default=0.
--   DETENER: solo uno devuelve fila, o cualquiera difiere de esa definición.
--
-- Los SHOW CREATE son respaldo opcional para revisar posición/DDL completo;
-- tampoco escriben ni alteran datos.

SHOW COLUMNS FROM tms_cliente_rutas
LIKE 'servicio_refrigerado_habitual';

SHOW COLUMNS FROM tms_cotizaciones
LIKE 'servicio_refrigerado';

SHOW CREATE TABLE tms_cliente_rutas;
SHOW CREATE TABLE tms_cotizaciones;

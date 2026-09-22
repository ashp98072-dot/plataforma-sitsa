-- SOLO LECTURA. Compatible con los permisos restringidos de Hostinger.
-- FASE A (ejecutar siempre):
-- - ambas ausentes: APLICAR la migración; NO ejecutar la fase B.
-- - solo una presente: DETENER.
-- - ambas presentes: ejecutar manualmente la fase B comentada más abajo.
SHOW TABLES LIKE 'tms_viatico_requerimientos';
SHOW TABLES LIKE 'tms_viatico_requerimiento_lineas';

-- FASE B (descomentar SOLO si la fase A devolvió ambas tablas):
-- SHOW CREATE TABLE tms_viatico_requerimientos;
-- SHOW CREATE TABLE tms_viatico_requerimiento_lineas;
-- SHOW COLUMNS FROM tms_viatico_requerimientos;
-- SHOW COLUMNS FROM tms_viatico_requerimiento_lineas;
-- SHOW INDEX FROM tms_viatico_requerimientos;
-- SHOW INDEX FROM tms_viatico_requerimiento_lineas;
-- Si ambos CREATE coinciden con migrate/schema: NOOP. Si difieren: DETENER.

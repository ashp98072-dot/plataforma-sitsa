-- SOLO LECTURA. Compatible con los permisos restringidos de Hostinger.
-- 1) Si ninguna tabla aparece: APLICAR la migración.
-- 2) Si ambas aparecen: comparar los SHOW CREATE con migrate/schema; si coinciden: NOOP.
-- 3) Si solo aparece una o cualquier definición difiere: DETENER.
SHOW TABLES LIKE 'tms_viatico_requerimientos';
SHOW TABLES LIKE 'tms_viatico_requerimiento_lineas';

-- Ejecutar estos SHOW CREATE únicamente cuando ambas tablas existan.
SHOW CREATE TABLE tms_viatico_requerimientos;
SHOW CREATE TABLE tms_viatico_requerimiento_lineas;

-- Comprobaciones puntuales adicionales (solo lectura).
SHOW COLUMNS FROM tms_viatico_requerimientos;
SHOW COLUMNS FROM tms_viatico_requerimiento_lineas;
SHOW INDEX FROM tms_viatico_requerimientos;
SHOW INDEX FROM tms_viatico_requerimiento_lineas;

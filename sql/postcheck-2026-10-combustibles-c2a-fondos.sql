-- SOLO LECTURA. Ejecutar manualmente después de migrate; no desde aplicación/build.
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE tms_solicitud_fondo_lineas;
SHOW CREATE TABLE flota_combustible_cargas;
SHOW INDEX FROM tms_solicitud_fondo_lineas;
SHOW INDEX FROM flota_combustible_cargas;
SHOW TABLE STATUS LIKE 'tms_solicitud_fondo_lineas';
SHOW TABLE STATUS LIKE 'flota_combustible_cargas';
SELECT COUNT(*) AS vales, SUM(solicitud_fondo_linea_id IS NOT NULL) AS vinculados FROM flota_combustible_cargas;
SELECT c.id, c.empresa_id, c.solicitud_fondo_linea_id FROM flota_combustible_cargas c
LEFT JOIN tms_solicitud_fondo_lineas l ON l.empresa_id=c.empresa_id AND l.id=c.solicitud_fondo_linea_id
WHERE c.solicitud_fondo_linea_id IS NOT NULL AND l.id IS NULL;
-- Esperado: 0 huérfanos, conteo de vales igual al preflight; primer despliegue sin escritores => 0 vinculados.
-- No inferir vínculos para históricos. Confirmar índices/FK RESTRICT exactos de migrate.

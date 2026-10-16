-- SOLO LECTURA. Seleccionar expresamente la BD objetivo en phpMyAdmin.
-- No ejecutar migrate hasta revisar todas las salidas y autorizar el contrato físico.
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE tms_solicitudes_fondo;
SHOW CREATE TABLE tms_solicitud_fondo_lineas;
SHOW CREATE TABLE flota_combustible_cargas;
SHOW FULL COLUMNS FROM tms_solicitud_fondo_lineas;
SHOW FULL COLUMNS FROM flota_combustible_cargas;
SHOW INDEX FROM tms_solicitud_fondo_lineas;
SHOW INDEX FROM flota_combustible_cargas;
SHOW TABLE STATUS LIKE 'tms_solicitudes_fondo';
SHOW TABLE STATUS LIKE 'tms_solicitud_fondo_lineas';
SHOW TABLE STATUS LIKE 'flota_combustible_cargas';
SHOW COLUMNS FROM flota_combustible_cargas LIKE 'solicitud_fondo_linea_id';
SELECT COUNT(*) AS lineas, MIN(id) AS primer_id, MAX(id) AS ultimo_id FROM tms_solicitud_fondo_lineas;
SELECT COUNT(*) AS vales, MIN(id) AS primer_id, MAX(id) AS ultimo_id FROM flota_combustible_cargas;
SELECT l.empresa_id, l.id, COUNT(*) AS repetidos FROM tms_solicitud_fondo_lineas l GROUP BY l.empresa_id,l.id HAVING COUNT(*)>1;
SELECT l.id, l.empresa_id, l.solicitud_id FROM tms_solicitud_fondo_lineas l
LEFT JOIN tms_solicitudes_fondo s ON s.id=l.solicitud_id AND s.empresa_id=l.empresa_id WHERE s.id IS NULL;
SELECT categoria, s.estado, COUNT(*) AS lineas FROM tms_solicitud_fondo_lineas l
JOIN tms_solicitudes_fondo s ON s.id=l.solicitud_id AND s.empresa_id=l.empresa_id GROUP BY categoria,s.estado;
-- APLICAR: MariaDB 11.8.9, InnoDB en las tres tablas; id/empresa_id INT signed NOT NULL,
-- id PK individual en cargas/líneas; padre solicitud con relación compuesta vigente;
-- sin huérfanos; sin columna ni objetos uq_fondolin_c2a_empresa_id, idx_fcc_fondo_linea, fk_fcc_fondo_linea.
-- Confirmar que esos nombres no están ocupados por otro objeto según SHOW CREATE de las tablas.
-- NOOP: todos los objetos C2A tienen EXACTAMENTE el contrato de migrate y postcheck sin huérfanos.
-- DETENER: estado parcial, objeto/nombre divergente, tipos/engine incompatibles, permisos metadata insuficientes.
-- Si la columna existe, ejecutar también el postcheck de SOLO LECTURA para comprobar sus referencias.
-- La compuerta de migrate usa information_schema SOLO para metadata de DATABASE();
-- si Hostinger no permite leerla, DETENER: no ejecutar ALTER sueltos para saltar la compuerta.

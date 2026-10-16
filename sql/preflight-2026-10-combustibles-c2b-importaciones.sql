-- SOLO LECTURA. Seleccionar la BD objetivo en phpMyAdmin; no ejecutar migrate sin aprobación.
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SELECT @@foreign_key_checks AS foreign_key_checks, @@check_constraint_checks AS check_constraint_checks;
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE usuarios;
SHOW CREATE TABLE compras_proveedores;
SHOW CREATE TABLE auditoria;
SHOW CREATE TABLE flota_combustible_conciliaciones;
SHOW CREATE TABLE flota_combustible_conciliacion_filas;
SHOW FULL COLUMNS FROM flota_combustible_conciliaciones;
SHOW FULL COLUMNS FROM flota_combustible_conciliacion_filas;
SHOW INDEX FROM flota_combustible_conciliaciones;
SHOW INDEX FROM flota_combustible_conciliacion_filas;
SHOW INDEX FROM compras_proveedores;
SHOW TABLE STATUS LIKE 'flota_combustible_conciliaciones';
SHOW TABLE STATUS LIKE 'flota_combustible_conciliacion_filas';
SHOW TABLE STATUS LIKE 'empresas';
SHOW TABLE STATUS LIKE 'usuarios';
SHOW TABLE STATUS LIKE 'compras_proveedores';
SHOW TABLE STATUS LIKE 'auditoria';
SHOW TABLES LIKE 'flota_combustible_import%';
SELECT COUNT(*) AS cabeceras FROM flota_combustible_conciliaciones;
SELECT COUNT(*) AS filas FROM flota_combustible_conciliacion_filas;
SELECT c.id FROM flota_combustible_conciliaciones c LEFT JOIN empresas e ON e.id=c.empresa_id WHERE e.id IS NULL;
SELECT f.id FROM flota_combustible_conciliacion_filas f LEFT JOIN flota_combustible_conciliaciones c
 ON c.id=f.conciliacion_id AND c.empresa_id=f.empresa_id WHERE c.id IS NULL;
-- APLICAR: MariaDB 11.8.9, padres InnoDB, id/empresa_id/conciliacion_id INT signed;
-- compras_proveedores UNIQUE(empresa_id,id); sin huérfanos ni nombres ocupados por otra definición;
-- NINGUNO de los campos/índices/FKs C2B presente. Comparar SHOW CREATE completo con migrate.
-- NOOP: TODOS los campos/índices/FKs C2B coinciden exactamente, también JSON_VALID en JSON/LONGTEXT.
-- DETENER: objeto parcial, tipos/engines divergentes, otras tablas de importación equivalentes,
-- índices/FKs de igual nombre y otra definición, huérfanos, duplicados o permisos insuficientes.
-- Collation: conservar la real de cada tabla; FKs nuevas solo INT, no convertir collations.
-- foreign_key_checks/check_constraint_checks deben estar ON; auditoria debe ser InnoDB.
-- Uploads: comprobar operativamente UPLOAD_DIR persistente privado y permisos del proceso,
-- sin revelar credenciales ni probar escrituras en producción durante este preflight.
-- Reutiliza archivo+filas existentes; no se crean tablas paralelas. Ver docs para contrato y rollout.

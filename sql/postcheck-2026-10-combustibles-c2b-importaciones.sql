-- SOLO LECTURA. Comparar conteos y SHOW CREATE con preflight y contrato aprobado.
SELECT DATABASE() AS base_objetivo, VERSION() AS version_servidor;
SHOW CREATE TABLE flota_combustible_conciliaciones;
SHOW CREATE TABLE flota_combustible_conciliacion_filas;
SHOW INDEX FROM flota_combustible_conciliaciones;
SHOW INDEX FROM flota_combustible_conciliacion_filas;
SELECT COUNT(*) AS cabeceras, SUM(perfil_parser='HALEL') AS importaciones FROM flota_combustible_conciliaciones;
SELECT COUNT(*) AS filas, SUM(estado_parseo IS NOT NULL) AS filas_c2b FROM flota_combustible_conciliacion_filas;
SELECT empresa_id,proveedor_id,archivo_sha256,COUNT(*) AS repetidos FROM flota_combustible_conciliaciones
 WHERE archivo_sha256 IS NOT NULL GROUP BY empresa_id,proveedor_id,archivo_sha256 HAVING COUNT(*)>1;
SELECT f.id FROM flota_combustible_conciliacion_filas f LEFT JOIN flota_combustible_conciliaciones c
 ON c.empresa_id=f.empresa_id AND c.id=f.conciliacion_id WHERE c.id IS NULL;
-- Antes de abrir escrituras: mismos conteos, 0 HALEL/filas C2B, 0 repetidos y 0 huérfanos.
-- Verificar FKs compuestas RESTRICT y JSON_VALID; segunda ejecución sobre contrato idéntico no cambia filas.

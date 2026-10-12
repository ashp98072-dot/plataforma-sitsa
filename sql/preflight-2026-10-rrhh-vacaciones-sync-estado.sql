-- SOLO LECTURA. Esquema explícito, sin DATABASE() ni information_schema.
-- Bloque A: ejecutar ANTES de la migración. APLICAR si no existe y padres compatibles.
SELECT VERSION() AS version_servidor, @@foreign_key_checks AS foreign_key_checks, @@check_constraint_checks AS check_constraint_checks;
SHOW TABLES FROM u611730801_Plataforma LIKE 'rrhh_vacaciones_sync_estado';
SHOW CREATE TABLE u611730801_Plataforma.empresas;
SHOW CREATE TABLE u611730801_Plataforma.empleados;
SHOW INDEX FROM u611730801_Plataforma.empleados;
SELECT COUNT(*) AS empleados_activos_con_alta FROM u611730801_Plataforma.empleados
WHERE estado = 'Activo' AND fecha_alta IS NOT NULL;
-- DETENER si ids no son INT signed, padres no InnoDB, o no existe índice
-- UNIQUE (empresa_id,id) en empleados. No importa el nombre del índice.
-- Si existe la tabla, NOOP solo si coincide íntegramente con el DDL; de otro modo DETENER.
--
-- Bloque B: ejecutar SOLO cuando SHOW TABLES devolvió la tabla (antes o después).
SHOW CREATE TABLE u611730801_Plataforma.rrhh_vacaciones_sync_estado;
SELECT COUNT(*) AS filas_sync, COALESCE(SUM(dirty = 1), 0) AS dirty
FROM u611730801_Plataforma.rrhh_vacaciones_sync_estado;
-- Clasificación completa de activos. Fingerprints de v1/política actual del repositorio.
SELECT COUNT(*) AS activos, COALESCE(SUM(necesita_sync = 0), 0) AS frescos,
 COALESCE(SUM(necesita_sync = 1), 0) AS stale_o_dirty_o_nunca_sync
FROM (
 SELECT e.id, (s.id_empleado IS NULL OR s.dirty = 1 OR s.ultima_sync_fecha IS NULL
  OR s.ultima_sync_fecha < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '-06:00'))
  OR NOT (s.fecha_alta_sync <=> e.fecha_alta)
  OR s.politica_fingerprint IS NULL OR s.politica_fingerprint <> CASE WHEN EXISTS (
   SELECT 1 FROM u611730801_Plataforma.configuracion c
   WHERE c.empresa_id = e.empresa_id AND c.parametro = 'vacaciones_modo_carga_historica' AND TRIM(c.valor) = '1'
  ) THEN 'v1:CARGA_HISTORICA:sin-limite:0' ELSE 'v1:NORMAL:2:1' END) AS necesita_sync
 FROM u611730801_Plataforma.empleados e
 LEFT JOIN u611730801_Plataforma.rrhh_vacaciones_sync_estado s ON s.empresa_id = e.empresa_id AND s.id_empleado = e.id
 WHERE e.estado = 'Activo' AND e.fecha_alta IS NOT NULL
) AS clasificacion;
SELECT empresa_id, id_empleado, COUNT(*) AS repetidos
FROM u611730801_Plataforma.rrhh_vacaciones_sync_estado GROUP BY empresa_id,id_empleado HAVING COUNT(*) > 1;
SELECT s.empresa_id, s.id_empleado FROM u611730801_Plataforma.rrhh_vacaciones_sync_estado s
LEFT JOIN u611730801_Plataforma.empleados e ON e.empresa_id = s.empresa_id AND e.id = s.id_empleado
WHERE e.id IS NULL;
SELECT empresa_id, parametro, valor FROM u611730801_Plataforma.configuracion
WHERE parametro = 'vacaciones_modo_carga_historica';

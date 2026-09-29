-- POSTCHECK (SOLO LECTURA) — ATRACCION-TALENTO-2 (entrevistador/auxiliar por usuario)
-- Ejecutar DESPUÉS de sql/migrate-atraccion-entrevistadores-usuarios.sql.
-- Ninguna sentencia de este archivo escribe nada.

-- 1) Las columnas nuevas existen, son NULL y entrevistador_empleado_id (histórico)
--    sigue intacto.
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entrevistas'
  AND COLUMN_NAME IN ('entrevistador_empleado_id', 'entrevistador_usuario_id', 'auxiliar_usuario_id')
ORDER BY ORDINAL_POSITION;

-- 2) Índices nuevos presentes.
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entrevistas'
  AND INDEX_NAME IN ('idx_entrev_entrevistador_usuario', 'idx_entrev_auxiliar_usuario')
GROUP BY INDEX_NAME;
-- Esperado: dos filas, cada una con columnas = empresa_id,<columna_usuario>.

-- 3) Foreign keys nuevas presentes, apuntando a usuarios(id), ON DELETE SET NULL.
SELECT
  kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME,
  rc.DELETE_RULE
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
WHERE kcu.TABLE_SCHEMA = DATABASE() AND kcu.TABLE_NAME = 'entrevistas'
  AND kcu.CONSTRAINT_NAME IN ('fk_entrev_entrevistador_usuario', 'fk_entrev_auxiliar_usuario')
ORDER BY kcu.CONSTRAINT_NAME;
-- Esperado: dos filas; REFERENCED_TABLE_NAME=usuarios, REFERENCED_COLUMN_NAME=id,
-- DELETE_RULE=SET NULL en ambas.

-- 4) Conteo de entrevistas preservadas por empresa — comparar 1:1 contra el
--    resultado del bloque 9 del preflight (mismos totales, ninguna fila perdida).
SELECT empresa_id, COUNT(*) AS entrevistas_actuales
FROM entrevistas
GROUP BY empresa_id
ORDER BY empresa_id;

-- 5) Cuántas entrevistas quedan con cada fuente de entrevistador — justo
--    después de migrar debe ser: entrevistador_usuario_id = 0 (no hay
--    backfill), entrevistador_empleado_id = igual que antes de migrar.
SELECT
  COUNT(*) AS total,
  SUM(CASE WHEN entrevistador_empleado_id IS NOT NULL THEN 1 ELSE 0 END) AS con_empleado_historico,
  SUM(CASE WHEN entrevistador_usuario_id IS NOT NULL THEN 1 ELSE 0 END) AS con_entrevistador_usuario,
  SUM(CASE WHEN auxiliar_usuario_id IS NOT NULL THEN 1 ELSE 0 END) AS con_auxiliar_usuario
FROM entrevistas;

-- 6) Motor y charset de entrevistas sin cambios.
SELECT ENGINE, TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'entrevistas';

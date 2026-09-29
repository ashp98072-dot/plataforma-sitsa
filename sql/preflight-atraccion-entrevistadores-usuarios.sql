-- PREFLIGHT (SOLO LECTURA) — ATRACCION-TALENTO-2 (entrevistador/auxiliar por usuario)
-- Ejecutar ANTES de sql/migrate-atraccion-entrevistadores-usuarios.sql en un
-- entorno real. Ninguna sentencia de este archivo escribe nada — todas son
-- SELECT/SHOW. Si algo no coincide con lo esperado, DETENERSE y revisar
-- antes de migrar.

-- 1) Las tablas involucradas deben existir.
SHOW TABLES LIKE 'entrevistas';
SHOW TABLES LIKE 'usuarios';

-- 2) entrevistas.id, usuarios.id y entrevistas.entrevistador_empleado_id
--    deben ser INT (mismo tipo que las columnas nuevas
--    entrevistador_usuario_id/auxiliar_usuario_id, que referencian usuarios.id).
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'entrevistas' AND COLUMN_NAME IN ('id', 'entrevistador_empleado_id'))
    OR (TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'id'));

-- 3) entrevistador_empleado_id (histórico) debe seguir existiendo tal cual —
--    esta migración NO lo toca ni lo elimina, solo agrega columnas nuevas.
SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'entrevistas' AND COLUMN_NAME = 'entrevistador_empleado_id';

-- 4) Las columnas nuevas NO deben existir todavía (si ya existen, revisar si
--    esta migración ya se aplicó antes de reintentar).
SELECT TABLE_NAME, COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'entrevistas'
  AND COLUMN_NAME IN ('entrevistador_usuario_id', 'auxiliar_usuario_id');
-- Esperado: CERO filas. Si devuelve alguna, la columna ya existe — no
-- reintentar la migración sin revisar antes.

-- 5) Los índices nuevos NO deben existir todavía.
SELECT TABLE_NAME, INDEX_NAME
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'entrevistas'
  AND INDEX_NAME IN ('idx_entrev_entrevistador_usuario', 'idx_entrev_auxiliar_usuario');
-- Esperado: CERO filas.

-- 6) Los nombres de FK son globales dentro del schema. Antes de migrar, esta
--    consulta debe devolver CERO filas. Si devuelve alguna, DETENER y
--    revisar el conflicto; no renombrar ni alterar en producción.
SELECT TABLE_NAME, CONSTRAINT_NAME
FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
  AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  AND CONSTRAINT_NAME IN ('fk_entrev_entrevistador_usuario', 'fk_entrev_auxiliar_usuario');
-- Esperado: CERO filas.

-- 7) Motor InnoDB en ambas tablas (las FK nuevas lo requieren).
SELECT TABLE_NAME, ENGINE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('entrevistas', 'usuarios');

-- 8) Huérfanos relevantes: entrevistas cuyo entrevistador_empleado_id ya no
--    tiene fila en empleados (informativo — la migración no los toca ni los
--    corrige, solo agrega columnas nuevas en NULL).
SELECT COUNT(*) AS entrevistas_con_empleado_huerfano
FROM entrevistas ent
WHERE ent.entrevistador_empleado_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM empleados e WHERE e.id = ent.entrevistador_empleado_id);

-- 9) Conteo actual de entrevistas por empresa (para comparar con el postcheck
--    y confirmar que la migración no borró/alteró filas existentes).
SELECT empresa_id, COUNT(*) AS entrevistas_actuales
FROM entrevistas
GROUP BY empresa_id
ORDER BY empresa_id;

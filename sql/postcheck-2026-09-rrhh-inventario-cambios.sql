-- POSTCHECK (SOLO LECTURA) — RRHH-INVENTARIO-CAMBIOS-1
-- Ejecutar DESPUÉS de aplicar sql/migrate-2026-09-rrhh-inventario-cambios.sql
-- en un entorno real. Ninguna sentencia de este archivo escribe nada.

-- 1) La tabla existe.
SHOW TABLES LIKE 'inventario_rrhh_ajustes';

-- 2) Columnas esperadas (11) — comparar contra el migrate si algo no calza.
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_rrhh_ajustes'
ORDER BY ORDINAL_POSITION;

-- 3) Índices esperados: PRIMARY, idx_ajustes_entrega, uq_ajustes_entrega_nueva,
--    idx_ajustes_empresa (este último puede verse como parte de una FK también).
SHOW INDEX FROM inventario_rrhh_ajustes;

-- 3b) Debe ser ÚNICO, con exactamente empresa_id y entrega_nueva_id en ese
--     orden. Los múltiples NULL de las devoluciones siguen permitidos.
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas,
       MIN(NON_UNIQUE) AS non_unique, COUNT(*) AS cantidad_columnas
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'inventario_rrhh_ajustes'
  AND INDEX_NAME = 'uq_ajustes_entrega_nueva'
GROUP BY INDEX_NAME;
-- Esperado: una fila; columnas=empresa_id,entrega_nueva_id;
-- non_unique=0; cantidad_columnas=2. Cualquier otro resultado: DETENER.

-- 4) Foreign keys esperadas (6): empresa, entrega, articulo_nuevo,
--    entrega_nueva, mov_devolucion, mov_salida.
SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'inventario_rrhh_ajustes'
  AND REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY CONSTRAINT_NAME;

-- 5) La tabla debe estar VACÍA justo después de crearse (nadie la escribió
--    todavía — la migración solo crea la tabla, nunca inserta filas).
SELECT COUNT(*) AS filas_iniciales_debe_ser_cero FROM inventario_rrhh_ajustes;

-- 6) Motor y charset correctos.
SELECT ENGINE, TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'inventario_rrhh_ajustes';

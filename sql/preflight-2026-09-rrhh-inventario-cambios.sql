-- PREFLIGHT (SOLO LECTURA) — RRHH-INVENTARIO-CAMBIOS-1
-- Ejecutar ANTES de aplicar sql/migrate-2026-09-rrhh-inventario-cambios.sql
-- en un entorno real. Ninguna sentencia de este archivo escribe nada —
-- todas son SELECT/SHOW. Revisar el resultado de cada bloque antes de
-- continuar; si algo no coincide con lo esperado (columna comentada),
-- DETENERSE y revisar antes de migrar.

-- 1) La tabla NO debe existir todavía (migración nueva). Si YA existe,
--    comparar su estructura contra el migrate antes de reintentar —
--    CREATE TABLE IF NOT EXISTS es idempotente pero no valida columnas.
SHOW TABLES LIKE 'inventario_rrhh_ajustes';

-- 2) Las tablas padre que referencian las FK deben existir.
SHOW TABLES LIKE 'empresas';
SHOW TABLES LIKE 'inventario_rrhh';
SHOW TABLES LIKE 'inventario_rrhh_entregas';
SHOW TABLES LIKE 'inventario_rrhh_movimientos';

-- 3) inventario_rrhh_entregas.id e inventario_rrhh.id deben ser INT (mismo
--    tipo que las columnas FK nuevas: articulo_nuevo_id, entrega_nueva_id).
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('inventario_rrhh', 'inventario_rrhh_entregas', 'inventario_rrhh_movimientos')
  AND COLUMN_NAME = 'id';

-- 4) inventario_rrhh_entregas.estado e inventario_rrhh_movimientos.tipo
--    deben seguir siendo VARCHAR sin lista cerrada (confirma que esta
--    migración NO necesita ALTER TABLE sobre ninguna tabla existente —
--    ver sql/discovery-2026-09-rrhh-inventario-cambios.sql).
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND ((TABLE_NAME = 'inventario_rrhh_entregas' AND COLUMN_NAME = 'estado')
    OR (TABLE_NAME = 'inventario_rrhh_movimientos' AND COLUMN_NAME = 'tipo'));

-- 5) Motor InnoDB en las tablas relacionadas (las FK nuevas lo requieren).
SELECT TABLE_NAME, ENGINE
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('empresas', 'inventario_rrhh', 'inventario_rrhh_entregas', 'inventario_rrhh_movimientos');

-- POSTCHECK (SOLO LECTURA) — unicidad de proveedores en Compras
-- Ejecutar DESPUÉS de sql/migrate-2026-09-compras-proveedores-unicidad.sql.
-- Ninguna sentencia de este archivo escribe nada.

-- 1) Columnas nuevas existen, con el tipo/nulabilidad esperados.
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores'
  AND COLUMN_NAME IN ('nombre_normalizado', 'nit_normalizado')
ORDER BY ORDINAL_POSITION;

-- 2) nombre_normalizado no debe quedar NULL en ninguna fila (todo proveedor tiene nombre_comercial).
SELECT COUNT(*) AS filas_sin_nombre_normalizado
FROM compras_proveedores
WHERE nombre_normalizado IS NULL;
-- Esperado: 0.

-- 3) nit_normalizado solo debe ser NULL cuando nit es NULL/vacío (nunca al revés).
SELECT COUNT(*) AS inconsistencias_nit
FROM compras_proveedores
WHERE (nit IS NOT NULL AND TRIM(nit) <> '' AND nit_normalizado IS NULL)
   OR ((nit IS NULL OR TRIM(nit) = '') AND nit_normalizado IS NOT NULL);
-- Esperado: 0.

-- 4) Índices UNIQUE presentes, con las columnas correctas y en ese orden.
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas, MIN(NON_UNIQUE) AS non_unique
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores'
  AND INDEX_NAME IN ('uq_cb_proveedor_nombre', 'uq_cb_proveedor_nit')
GROUP BY INDEX_NAME;
-- Esperado: dos filas; uq_cb_proveedor_nombre = empresa_id,nombre_normalizado (non_unique=0);
-- uq_cb_proveedor_nit = empresa_id,nit_normalizado (non_unique=0).

-- 5) Cero duplicados según las columnas normalizadas (repetición del check final de la migración).
SELECT COUNT(*) AS grupos_duplicados_nombre FROM (
  SELECT 1 FROM compras_proveedores GROUP BY empresa_id, nombre_normalizado HAVING COUNT(*) > 1
) d;
SELECT COUNT(*) AS grupos_duplicados_nit FROM (
  SELECT 1 FROM compras_proveedores WHERE nit_normalizado IS NOT NULL GROUP BY empresa_id, nit_normalizado HAVING COUNT(*) > 1
) d;
-- Esperado: 0 en ambas.

-- 6) Conteo total por empresa preservado — comparar 1:1 contra el bloque 9 del preflight.
SELECT empresa_id, COUNT(*) AS proveedores_actuales,
       SUM(activo = 1) AS activos, SUM(activo = 0) AS inactivos
FROM compras_proveedores
GROUP BY empresa_id
ORDER BY empresa_id;

-- 7) Motor y charset de la tabla sin cambios.
SELECT ENGINE, TABLE_COLLATION
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores';

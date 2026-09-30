-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — unicidad de proveedores en Compras
-- Archivo: sql/preflight-2026-09-compras-proveedores-unicidad.sql
--
-- NO modifica nada: solo SELECT/SHOW. Ejecutar manualmente y revisar ANTES
-- de aplicar sql/migrate-2026-09-compras-proveedores-unicidad.sql.
--
-- IDENTIDAD de proveedor (misma regla que src/lib/compras/proveedor-identidad.ts):
--   A) empresa_id + nombre_comercial normalizado -> SIEMPRE identifica al proveedor.
--   B) empresa_id + NIT normalizado (si no está vacío) -> también identifica al proveedor.
-- NORMALIZACIÓN: recorta extremos, colapsa espacios internos a UNO, MAYÚSCULAS, SIN acentos
--   (mismo criterio que factura-compra.ts: "López" = "Lopez" = "LÓPEZ"). NIT además quita
--   espacios/guiones/puntos. NIT vacío/NULL NUNCA participa en la unicidad.
-- A diferencia de sql/migrate-2026-09-compras-facturas-unicas.sql (columna GENERADA que
-- depende de la colación utf8mb4_unicode_ci para ignorar acentos/mayúsculas), aquí el backend
-- calcula el valor normalizado en la aplicación (quita acentos explícitamente) y lo persiste
-- tal cual — por eso este preflight usa UPPER(...) sin más, SIN quitar acentos en SQL: los
-- acentos existentes en datos históricos SÍ importan para esta detección de duplicados
-- (si dos nombres solo difieren en acentos, la colación de la tabla — utf8mb4_unicode_ci —
-- los agrupará igual en el GROUP BY de abajo, ya que la comparación usa la colación de la
-- columna original nombre_comercial/nit).
-- =====================================================================

-- 0) Entorno (informativo)
SELECT VERSION() AS version_bd,
       (SELECT TABLE_COLLATION FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores') AS colacion_tabla,
       (SELECT ENGINE FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores') AS engine;

-- 1) Estructura actual (columnas existentes; confirma que nombre_normalizado/nit_normalizado
--    todavía NO existen, y que nombre_comercial/nit siguen siendo VARCHAR simples).
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLLATION_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores'
ORDER BY ORDINAL_POSITION;

-- 2) Las columnas nuevas NO deben existir todavía.
SELECT COLUMN_NAME
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores'
  AND COLUMN_NAME IN ('nombre_normalizado', 'nit_normalizado');
-- Esperado: CERO filas.

-- 3) Los índices UNIQUE nuevos NO deben existir todavía.
SELECT INDEX_NAME
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'compras_proveedores'
  AND INDEX_NAME IN ('uq_cb_proveedor_nombre', 'uq_cb_proveedor_nit');
-- Esperado: CERO filas.

-- 4) RESUMEN: nombres duplicados por empresa (si devuelve filas, HAY que resolverlos
--    manualmente — decidir cuál es el proveedor "real" — ANTES de cualquier UNIQUE).
SELECT empresa_id,
       UPPER(TRIM(REGEXP_REPLACE(nombre_comercial, '[[:space:]]+', ' '))) AS nombre_normalizado_aprox,
       COUNT(*) AS cantidad,
       GROUP_CONCAT(CONCAT('#', id, ' (', IF(activo = 1, 'activo', 'INACTIVO'), ')') ORDER BY id SEPARATOR ' | ') AS proveedores
FROM compras_proveedores
GROUP BY empresa_id, UPPER(TRIM(REGEXP_REPLACE(nombre_comercial, '[[:space:]]+', ' ')))
HAVING COUNT(*) > 1
ORDER BY empresa_id, nombre_normalizado_aprox;
-- Nota: esta agrupación aproxima la normalización real (no quita acentos en SQL). La
-- colación utf8mb4_unicode_ci de la columna ya agrupa variantes de acento/mayúscula al
-- comparar con GROUP BY, así que sigue siendo una detección fiable de los mismos casos que
-- verá la aplicación (que si acaso, es MÁS estricta al quitar acentos explícitamente).

-- 5) RESUMEN: NIT duplicados por empresa (ignora NIT vacío/NULL).
SELECT empresa_id,
       UPPER(REPLACE(REPLACE(REPLACE(TRIM(nit), ' ', ''), '-', ''), '.', '')) AS nit_normalizado_aprox,
       COUNT(*) AS cantidad,
       GROUP_CONCAT(CONCAT('#', id, ' (', IF(activo = 1, 'activo', 'INACTIVO'), ')') ORDER BY id SEPARATOR ' | ') AS proveedores
FROM compras_proveedores
WHERE nit IS NOT NULL AND TRIM(nit) <> ''
GROUP BY empresa_id, UPPER(REPLACE(REPLACE(REPLACE(TRIM(nit), ' ', ''), '-', ''), '.', ''))
HAVING COUNT(*) > 1
ORDER BY empresa_id, nit_normalizado_aprox;

-- 6) DETALLE de los nombres duplicados (una fila por proveedor involucrado, para decidir a mano).
SELECT p.empresa_id, p.id, p.nombre_comercial, p.razon_social, p.nit, p.activo, p.creado_en
FROM compras_proveedores p
INNER JOIN (
  SELECT empresa_id, UPPER(TRIM(REGEXP_REPLACE(nombre_comercial, '[[:space:]]+', ' '))) AS n
  FROM compras_proveedores
  GROUP BY empresa_id, UPPER(TRIM(REGEXP_REPLACE(nombre_comercial, '[[:space:]]+', ' ')))
  HAVING COUNT(*) > 1
) d ON d.empresa_id = p.empresa_id
   AND d.n = UPPER(TRIM(REGEXP_REPLACE(p.nombre_comercial, '[[:space:]]+', ' ')))
ORDER BY p.empresa_id, d.n, p.id;

-- 7) DETALLE de los NIT duplicados.
SELECT p.empresa_id, p.id, p.nombre_comercial, p.nit, p.activo, p.creado_en
FROM compras_proveedores p
INNER JOIN (
  SELECT empresa_id, UPPER(REPLACE(REPLACE(REPLACE(TRIM(nit), ' ', ''), '-', ''), '.', '')) AS n
  FROM compras_proveedores
  WHERE nit IS NOT NULL AND TRIM(nit) <> ''
  GROUP BY empresa_id, UPPER(REPLACE(REPLACE(REPLACE(TRIM(nit), ' ', ''), '-', ''), '.', ''))
  HAVING COUNT(*) > 1
) d ON d.empresa_id = p.empresa_id
   AND d.n = UPPER(REPLACE(REPLACE(REPLACE(TRIM(p.nit), ' ', ''), '-', ''), '.', ''))
WHERE p.nit IS NOT NULL AND TRIM(p.nit) <> ''
ORDER BY p.empresa_id, d.n, p.id;

-- 8) Vacíos/NULL (informativo — cuántos proveedores no tienen NIT; nunca bloquean el UNIQUE de NIT).
SELECT COUNT(*) AS proveedores_sin_nit
FROM compras_proveedores
WHERE nit IS NULL OR TRIM(nit) = '';

-- 9) Conteo total por empresa (para comparar 1:1 contra el postcheck y confirmar que la
--    migración no pierde ni agrega filas).
SELECT empresa_id, COUNT(*) AS proveedores_actuales,
       SUM(activo = 1) AS activos, SUM(activo = 0) AS inactivos
FROM compras_proveedores
GROUP BY empresa_id
ORDER BY empresa_id;

-- =====================================================================
-- CRITERIO DE DECISIÓN
--   * Si (4) o (5) devuelven filas: DETENER. Resolver manualmente cada grupo (decidir cuál
--     registro es el proveedor real, inactivar o corregir el resto) y repetir el preflight.
--   * Si ambos devuelven CERO filas: se puede aplicar
--     sql/migrate-2026-09-compras-proveedores-unicidad.sql, que vuelve a verificar 0
--     duplicados (con la normalización REAL, con acentos quitados) justo antes de crear el
--     UNIQUE — si algo cambió entretanto, el ALTER se niega solo y no toca nada.
-- =====================================================================

-- =====================================================================
-- MIGRACIÓN (MariaDB/InnoDB) — factura única por proveedor en Compras / Requerimientos
-- Archivo: sql/migrate-2026-09-compras-facturas-unicas.sql
--
-- NO SE EJECUTA AUTOMÁTICAMENTE. Se ejecuta manualmente, una sola vez, con autorización.
-- Precondición cumplida: sql/preflight-2026-09-compras-facturas-unicas.sql devolvió 0 grupos duplicados en producción.
--
-- QUÉ HACE (un único ALTER TABLE, solo estructura):
--   1) Agrega la columna generada PERSISTENT `factura_clave` (nunca se escribe desde la aplicación):
--        NULL                                    si numero_factura es NULL o queda vacío tras normalizar
--        serie_normalizada + CHAR(1) + numero_normalizado   en otro caso
--      normalizar = TRIM de extremos + colapsar espacios internos a UNO (misma regla que src/lib/compras/factura-compra.ts).
--      Mayúsculas y acentos NO se tocan aquí: los ignora la colación utf8mb4_unicode_ci (igual que la aplicación).
--      Guiones y ceros iniciales SON significativos. Serie NULL = ''.
--   2) Agrega UNIQUE uq_compras_factura_proveedor (empresa_id, proveedor_id, factura_clave).
--      Varias líneas con factura_clave NULL (sin número) están permitidas por UNIQUE.
--
-- NO hace: DROP, DELETE, UPDATE, backfill, ni modifica serie_factura / numero_factura.
-- La protección de la aplicación (formulario, endpoint, GET_LOCK, FOR UPDATE) se mantiene aunque exista el índice.
--
-- SEGURIDAD: el ALTER solo se ejecuta si TODAS las guardas pasan; si alguna falla NO se toca nada y se muestra
-- "DETENER: ..." con el motivo. Ejecutar completo y revisar la salida del PRECHECK y del POSTCHECK.
-- Si MariaDB rechazara la columna generada con REGEXP_REPLACE o el UNIQUE sobre ella, el ALTER falla entero
-- (no queda nada a medias): DETENER y reportar, no improvisar otra estrategia.
-- =====================================================================

SET @db := DATABASE();

-- ------------------------------ PRECHECK ------------------------------
-- (1) la tabla existe
SET @tabla := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_requerimiento_lineas');
-- (2) todavía no existe la columna factura_clave
SET @col_existe := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_requerimiento_lineas' AND COLUMN_NAME = 'factura_clave');
-- (3) todavía no existe el índice uq_compras_factura_proveedor
SET @idx_existe := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_requerimiento_lineas' AND INDEX_NAME = 'uq_compras_factura_proveedor');
-- (4) colación compatible: serie/numero en utf8mb4_unicode_ci (misma comparación que la aplicación)
SET @colaciones_ok := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_requerimiento_lineas'
                        AND COLUMN_NAME IN ('serie_factura', 'numero_factura') AND COLLATION_NAME = 'utf8mb4_unicode_ci');
-- (4b) longitud de la clave: VARCHAR(220) x4 bytes en el UNIQUE exige ROW_FORMAT DYNAMIC/COMPRESSED (límite 3072 bytes)
SET @row_format_ok := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_requerimiento_lineas'
                        AND UPPER(ROW_FORMAT) IN ('DYNAMIC', 'COMPRESSED'));
-- (5) REGEXP_REPLACE soportado (si no existe, esta sentencia falla y el script se detiene aquí)
SET @regexp_ok := (SELECT REGEXP_REPLACE('  a   b  ', '[[:space:]]+', ' ') = ' a b ');
-- (6) 0 duplicados con la MISMA regla de la columna (se vuelve a verificar justo antes del ALTER)
SET @duplicados := (SELECT COUNT(*) FROM (
  SELECT 1 FROM compras_requerimiento_lineas
  WHERE numero_factura IS NOT NULL AND TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' ')) <> ''
  GROUP BY empresa_id, proveedor_id,
           TRIM(REGEXP_REPLACE(COALESCE(serie_factura, ''), '[[:space:]]+', ' ')),
           TRIM(REGEXP_REPLACE(numero_factura, '[[:space:]]+', ' '))
  HAVING COUNT(*) > 1
) d);

SET @motivo := CASE
  WHEN @tabla <> 1         THEN 'la tabla compras_requerimiento_lineas no existe'
  WHEN @col_existe <> 0    THEN 'ya existe la columna factura_clave'
  WHEN @idx_existe <> 0    THEN 'ya existe el índice uq_compras_factura_proveedor'
  WHEN @colaciones_ok <> 2 THEN 'serie_factura/numero_factura no usan utf8mb4_unicode_ci'
  WHEN @row_format_ok <> 1 THEN 'ROW_FORMAT de la tabla no es DYNAMIC/COMPRESSED (la clave UNIQUE excedería el límite de bytes)'
  WHEN @regexp_ok IS NULL OR @regexp_ok <> 1 THEN 'REGEXP_REPLACE no se comporta como se espera'
  WHEN @duplicados <> 0    THEN 'existen grupos de facturas duplicadas (resolverlos y repetir el preflight)'
  ELSE NULL END;

SELECT IF(@motivo IS NULL, 'PRECHECK OK: se aplicará el ALTER', CONCAT('DETENER: ', @motivo, ' — NO se modificó nada')) AS precheck,
       @tabla AS tabla, @col_existe AS col_existe, @idx_existe AS idx_existe, @colaciones_ok AS colaciones_ok,
       @row_format_ok AS row_format_ok, @regexp_ok AS regexp_ok, @duplicados AS grupos_duplicados;

-- ------------------------------ ALTER (condicionado) ------------------------------
SET @sql := IF(@motivo IS NULL,
  'ALTER TABLE compras_requerimiento_lineas
     ADD COLUMN factura_clave VARCHAR(220) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
       AS (CASE WHEN numero_factura IS NULL OR TRIM(REGEXP_REPLACE(numero_factura, ''[[:space:]]+'', '' '')) = '''' THEN NULL
                ELSE CONCAT(TRIM(REGEXP_REPLACE(COALESCE(serie_factura, ''''), ''[[:space:]]+'', '' '')), CHAR(1),
                            TRIM(REGEXP_REPLACE(numero_factura, ''[[:space:]]+'', '' ''))) END) PERSISTENT,
     ADD UNIQUE KEY uq_compras_factura_proveedor (empresa_id, proveedor_id, factura_clave)',
  'SELECT ''ALTER omitido: precheck no superado'' AS resultado');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ POSTCHECK ------------------------------
SHOW COLUMNS FROM compras_requerimiento_lineas LIKE 'factura_clave';
SHOW INDEX FROM compras_requerimiento_lineas WHERE Key_name = 'uq_compras_factura_proveedor';

-- 0 duplicados según factura_clave (solo si la columna existe)
SET @col_final := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_requerimiento_lineas' AND COLUMN_NAME = 'factura_clave');
SET @sql := IF(@col_final = 1,
  'SELECT COUNT(*) AS grupos_duplicados_por_factura_clave FROM (SELECT 1 FROM compras_requerimiento_lineas WHERE factura_clave IS NOT NULL GROUP BY empresa_id, proveedor_id, factura_clave HAVING COUNT(*) > 1) d',
  'SELECT ''factura_clave no existe (la migración no se aplicó)'' AS grupos_duplicados_por_factura_clave');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

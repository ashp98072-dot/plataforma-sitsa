-- =====================================================================
-- MIGRACIÓN (MariaDB/InnoDB) — unicidad de proveedores en Compras
-- Archivo: sql/migrate-2026-09-compras-proveedores-unicidad.sql
--
-- NO SE EJECUTA AUTOMÁTICAMENTE. Se ejecuta manualmente, una sola vez, con
-- autorización, DESPUÉS de revisar sql/preflight-2026-09-compras-proveedores-unicidad.sql
-- (los bloques 4 y 5 de ese preflight deben devolver CERO filas).
--
-- QUÉ HACE:
--   1) Agrega (si faltan) nombre_normalizado VARCHAR(200) NULL y
--      nit_normalizado VARCHAR(30) NULL — columnas NORMALES (no generadas): a partir de
--      ahora la APLICACIÓN las calcula y escribe en cada INSERT/UPDATE
--      (src/lib/compras/proveedor-identidad.ts + guardarProveedor en
--      src/lib/compras/proveedores.ts), dentro de la misma transacción.
--   2) Backfill DETERMINISTA de las filas existentes (idempotente: solo toca filas con
--      nombre_normalizado todavía NULL). Aproxima la normalización real con funciones SQL
--      (TRIM + colapsar espacios + MAYÚSCULAS); NO intenta quitar acentos en SQL (MariaDB no
--      tiene una función nativa de "quitar acentos") — la colación utf8mb4_unicode_ci de la
--      columna ya hace esa comparación insensible a acentos para el UNIQUE de abajo, igual
--      que sql/migrate-2026-09-compras-facturas-unicas.sql. Filas nuevas, escritas por la
--      aplicación, SÍ llegan ya sin acentos (normalizarNombreProveedor quita diacríticos) —
--      ambos casos colisionan correctamente entre sí gracias a la colación.
--      NO cambia nombre_comercial/nit visibles. NO elimina, NO fusiona, NO inactiva nada.
--   3) Solo si NO quedan duplicados según las columnas normalizadas (re-verificado aquí
--      mismo, justo antes de crear el índice): agrega los dos UNIQUE
--      (empresa_id, nombre_normalizado) y (empresa_id, nit_normalizado). MariaDB permite
--      múltiples NULL en un UNIQUE, así que los proveedores sin NIT no chocan entre sí.
--
-- SEGURIDAD: el ALTER que agrega los UNIQUE solo se ejecuta si TODAS las guardas pasan; si
-- alguna falla NO se toca nada y se muestra "DETENER: ..." con el motivo. Los pasos 1 y 2
-- (agregar columnas + backfill) son siempre seguros de re-ejecutar y no requieren guarda
-- adicional: nunca tocan nombre_comercial/nit ni datos ya normalizados.
-- =====================================================================

SET @db := DATABASE();

-- ------------------------------ PASO 1: columnas nuevas ------------------------------
SET @col_nombre := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_proveedores' AND COLUMN_NAME = 'nombre_normalizado');
SET @sql := IF(@col_nombre = 0,
  'ALTER TABLE compras_proveedores ADD COLUMN nombre_normalizado VARCHAR(200) NULL AFTER nombre_comercial',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_nit := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_proveedores' AND COLUMN_NAME = 'nit_normalizado');
SET @sql := IF(@col_nit = 0,
  'ALTER TABLE compras_proveedores ADD COLUMN nit_normalizado VARCHAR(30) NULL AFTER nit',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ PASO 2: backfill (idempotente) ------------------------------
UPDATE compras_proveedores
SET nombre_normalizado = UPPER(TRIM(REGEXP_REPLACE(nombre_comercial, '[[:space:]]+', ' '))),
    nit_normalizado = CASE WHEN nit IS NULL OR TRIM(nit) = '' THEN NULL
      ELSE UPPER(REPLACE(REPLACE(REPLACE(TRIM(nit), ' ', ''), '-', ''), '.', '')) END
WHERE nombre_normalizado IS NULL;

-- ------------------------------ PASO 3: PRECHECK del UNIQUE ------------------------------
SET @tabla := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_proveedores');
SET @idx_nombre_existe := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_proveedores' AND INDEX_NAME = 'uq_cb_proveedor_nombre');
SET @idx_nit_existe := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_proveedores' AND INDEX_NAME = 'uq_cb_proveedor_nit');
SET @sin_backfill := (SELECT COUNT(*) FROM compras_proveedores WHERE nombre_normalizado IS NULL);
SET @dup_nombre := (SELECT COUNT(*) FROM (
  SELECT 1 FROM compras_proveedores GROUP BY empresa_id, nombre_normalizado HAVING COUNT(*) > 1
) d);
SET @dup_nit := (SELECT COUNT(*) FROM (
  SELECT 1 FROM compras_proveedores WHERE nit_normalizado IS NOT NULL GROUP BY empresa_id, nit_normalizado HAVING COUNT(*) > 1
) d);

SET @motivo := CASE
  WHEN @tabla <> 1            THEN 'la tabla compras_proveedores no existe'
  WHEN @idx_nombre_existe <> 0 THEN 'ya existe el índice uq_cb_proveedor_nombre'
  WHEN @idx_nit_existe <> 0    THEN 'ya existe el índice uq_cb_proveedor_nit'
  WHEN @sin_backfill <> 0      THEN 'quedan filas sin backfill de nombre_normalizado (reintentar el PASO 2)'
  WHEN @dup_nombre <> 0        THEN 'existen nombres normalizados duplicados por empresa (resolverlos y repetir el preflight)'
  WHEN @dup_nit <> 0           THEN 'existen NIT normalizados duplicados por empresa (resolverlos y repetir el preflight)'
  ELSE NULL END;

SELECT IF(@motivo IS NULL, 'PRECHECK OK: se aplicará el ALTER de los UNIQUE', CONCAT('DETENER: ', @motivo, ' — NO se creó ningún UNIQUE')) AS precheck,
       @tabla AS tabla, @sin_backfill AS filas_sin_backfill, @dup_nombre AS grupos_duplicados_nombre, @dup_nit AS grupos_duplicados_nit;

-- ------------------------------ PASO 4: ALTER (condicionado) ------------------------------
SET @sql := IF(@motivo IS NULL,
  'ALTER TABLE compras_proveedores
     ADD UNIQUE KEY uq_cb_proveedor_nombre (empresa_id, nombre_normalizado),
     ADD UNIQUE KEY uq_cb_proveedor_nit (empresa_id, nit_normalizado)',
  'SELECT ''ALTER omitido: precheck no superado'' AS resultado');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ POSTCHECK ------------------------------
SHOW COLUMNS FROM compras_proveedores LIKE 'nombre_normalizado';
SHOW COLUMNS FROM compras_proveedores LIKE 'nit_normalizado';
SHOW INDEX FROM compras_proveedores WHERE Key_name IN ('uq_cb_proveedor_nombre', 'uq_cb_proveedor_nit');

SET @idx_final_nombre := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'compras_proveedores' AND INDEX_NAME = 'uq_cb_proveedor_nombre');
SET @sql := IF(@idx_final_nombre = 1,
  'SELECT COUNT(*) AS grupos_duplicados_nombre_final FROM (SELECT 1 FROM compras_proveedores GROUP BY empresa_id, nombre_normalizado HAVING COUNT(*) > 1) d',
  'SELECT ''uq_cb_proveedor_nombre no existe (la migración no se aplicó)'' AS grupos_duplicados_nombre_final');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — código administrativo persistido de Gastos (GASTO-000055)
-- Archivo: sql/preflight-2026-09-gastos-codigo.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de la FASE A (sql/migrate-2026-09-gastos-codigo.sql).
-- Regla del código: GASTO-<id, mínimo 6 dígitos>, idéntica a String(id).padStart(6, "0") de la app (nunca se trunca):
--   1 -> GASTO-000001 · 55 -> GASTO-000055 · 123456 -> GASTO-123456 · 1234567 -> GASTO-1234567
-- La expresión SQL es la MISMA que usan la fase A, la fase B y los postchecks.
-- =====================================================================

-- 1) Entorno y estructura actual (informativo; también sirve para detectar una ejecución parcial previa)
SELECT VERSION() AS version_bd,
       (SELECT COUNT(*) FROM information_schema.TABLES  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos') AS tabla_existe,
       (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') AS columna_codigo_existe,
       (SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') AS columna_codigo_nullable,
       (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos' AND INDEX_NAME = 'uq_gastos_empresa_codigo') AS indice_existe,
       (SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos') AS colacion_tabla;

-- 2) Volumen a rellenar
SELECT COUNT(*) AS gastos_totales, COUNT(DISTINCT empresa_id) AS empresas, MIN(id) AS id_minimo, MAX(id) AS id_maximo
FROM tms_gastos_operativos;

-- 3) BLOQUEANTES (deben dar 0; si alguno da > 0, DETENER). Ya NO se limita el id a 6 dígitos: 6 es el MÍNIMO, no el máximo.
SELECT SUM(id <= 0) AS ids_no_validos,
       SUM(CHAR_LENGTH(CONCAT('GASTO-', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, '0') ELSE CAST(id AS CHAR) END)) > 30) AS codigos_de_mas_de_30_caracteres
FROM tms_gastos_operativos;

-- 4) Duplicados que produciría el backfill por empresa (debe devolver 0 filas; el id es único, así que no debería haber)
SELECT empresa_id,
       CONCAT('GASTO-', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, '0') ELSE CAST(id AS CHAR) END) AS codigo_resultante,
       COUNT(*) AS veces
FROM tms_gastos_operativos
GROUP BY empresa_id, CONCAT('GASTO-', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, '0') ELSE CAST(id AS CHAR) END)
HAVING COUNT(*) > 1;

-- 5) Muestra de cómo quedarían los códigos (primeros y últimos)
(SELECT id, empresa_id, CONCAT('GASTO-', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, '0') ELSE CAST(id AS CHAR) END) AS codigo_resultante FROM tms_gastos_operativos ORDER BY id ASC  LIMIT 5)
UNION ALL
(SELECT id, empresa_id, CONCAT('GASTO-', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, '0') ELSE CAST(id AS CHAR) END) AS codigo_resultante FROM tms_gastos_operativos ORDER BY id DESC LIMIT 5);

-- 6) Estado de una ejecución parcial previa (solo si la columna ya existe): filas sin código y códigos inconsistentes
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo');
SET @sql := IF(@col = 1,
  'SELECT SUM(codigo IS NULL OR codigo = '''') AS sin_codigo,
          SUM(codigo IS NOT NULL AND codigo <> CONCAT(''GASTO-'', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, ''0'') ELSE CAST(id AS CHAR) END)) AS inconsistentes
     FROM tms_gastos_operativos',
  'SELECT ''la columna codigo todavía no existe'' AS estado_parcial');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- CRITERIO: (3) todo 0 y (4) sin filas -> se puede ejecutar la FASE A. Si la columna o el índice ya existen (ejecución parcial),
-- la fase A es idempotente por pasos y continúa donde quedó.
-- =====================================================================

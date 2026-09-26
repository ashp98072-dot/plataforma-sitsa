-- =====================================================================
-- MIGRACIÓN (MariaDB/InnoDB) — código administrativo persistido de Gastos: GASTO-<id, mínimo 6 dígitos>
-- FASE B / CONTRACT — se ejecuta DESPUÉS del deploy de la app nueva.
-- Archivo: sql/migrate-2026-09-gastos-codigo-finalizar.sql   (requiere haber aplicado la FASE A: sql/migrate-2026-09-gastos-codigo.sql)
--
-- NO SE EJECUTA AUTOMÁTICAMENTE. Ejecutar manualmente (phpMyAdmin). Puede re-ejecutarse con seguridad.
--
-- Qué hace:
--   1) comprueba que la columna `codigo` y el índice uq_gastos_empresa_codigo existen (si no, DETIENE);
--   2) re-backfill de cualquier fila que haya quedado con codigo NULL o '' durante la ventana entre la fase A y el deploy
--      (gastos creados por la app vieja);
--   3) valida: 0 sin código, 0 duplicados por empresa, 0 códigos distintos de GASTO-<id>;
--   4) recién entonces MODIFY COLUMN codigo VARCHAR(30) NOT NULL (solo si todavía es nullable);
--   5) postcheck final.
-- Regla del código: idéntica a String(id).padStart(6, "0") — mínimo 6 dígitos, nunca se trunca (1234567 -> GASTO-1234567).
-- NO hace: DROP, DELETE, TRUNCATE, ni cambia ids.
-- =====================================================================

SET @db := DATABASE();
-- Expresión ÚNICA del código (la misma en preflight, fase A, fase B y postchecks).
SET @cod := 'CONCAT(''GASTO-'', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, ''0'') ELSE CAST(id AS CHAR) END)';

-- ------------------------------ PRECHECK ------------------------------
SET @col_existe := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo');
SET @idx_existe := (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND INDEX_NAME = 'uq_gastos_empresa_codigo');

SET @motivo := CASE
  WHEN @col_existe <> 1  THEN 'la columna codigo no existe (aplicar antes la fase A: migrate-2026-09-gastos-codigo.sql)'
  WHEN @idx_existe < 1   THEN 'el índice uq_gastos_empresa_codigo no existe (aplicar antes la fase A)'
  ELSE NULL END;

SELECT IF(@motivo IS NULL, 'PRECHECK OK', CONCAT('DETENER: ', @motivo, ' — NO se modificó nada')) AS precheck,
       @col_existe AS columna_codigo, @idx_existe AS indice_unique;

-- ------------------------------ PASO 1: re-backfill de lo creado con NULL durante la ventana ------------------------------
SET @sql := IF(@motivo IS NULL,
  CONCAT('UPDATE tms_gastos_operativos SET codigo = ', @cod, ', actualizado_en = actualizado_en WHERE codigo IS NULL OR codigo = ''''' ),
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ PASO 2: validar antes del NOT NULL ------------------------------
SET @sin_codigo := NULL, @inconsistentes := NULL, @duplicados := NULL;
SET @sql := IF(@motivo IS NULL,
  CONCAT('SELECT (SELECT COUNT(*) FROM tms_gastos_operativos WHERE codigo IS NULL OR codigo = ''''),
                 (SELECT COUNT(*) FROM tms_gastos_operativos WHERE codigo IS NOT NULL AND codigo <> ', @cod, '),
                 (SELECT COUNT(*) FROM (SELECT 1 FROM tms_gastos_operativos WHERE codigo IS NOT NULL GROUP BY empresa_id, codigo HAVING COUNT(*) > 1) d)
            INTO @sin_codigo, @inconsistentes, @duplicados'),
  'SELECT NULL, NULL, NULL INTO @sin_codigo, @inconsistentes, @duplicados');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @motivo2 := CASE
  WHEN @motivo IS NOT NULL                THEN @motivo
  WHEN COALESCE(@sin_codigo, 1) <> 0      THEN 'quedaron gastos sin código'
  WHEN COALESCE(@inconsistentes, 1) <> 0  THEN 'hay códigos distintos de GASTO-<id> (p. ej. un marcador TMP- sin resolver)'
  WHEN COALESCE(@duplicados, 1) <> 0      THEN 'existen códigos duplicados por empresa'
  ELSE NULL END;

SELECT IF(@motivo2 IS NULL, 'VALIDACIÓN OK: se aplica NOT NULL', CONCAT('DETENER: ', @motivo2, ' — NO se aplicó NOT NULL')) AS validacion,
       @sin_codigo AS gastos_sin_codigo, @inconsistentes AS codigos_inconsistentes, @duplicados AS grupos_duplicados;

-- ------------------------------ PASO 3: NOT NULL (solo si todavía es nullable) ------------------------------
SET @sql := IF(@motivo2 IS NULL
    AND (SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') = 'YES',
  'ALTER TABLE tms_gastos_operativos MODIFY COLUMN codigo VARCHAR(30) NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ POSTCHECK FINAL ------------------------------
SHOW COLUMNS FROM tms_gastos_operativos LIKE 'codigo';   -- esperado: Null = NO
SHOW INDEX FROM tms_gastos_operativos WHERE Key_name = 'uq_gastos_empresa_codigo';

SET @col_final := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo');
SET @sql := IF(@col_final = 1,
  CONCAT('SELECT COUNT(*) AS gastos_totales,
                 SUM(codigo IS NULL OR codigo = '''') AS sin_codigo,
                 SUM(codigo IS NOT NULL AND codigo <> ', @cod, ') AS inconsistentes,
                 COUNT(DISTINCT empresa_id, codigo) AS codigos_distintos_por_empresa
            FROM tms_gastos_operativos'),
  'SELECT ''la columna codigo no existe'' AS resultado');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

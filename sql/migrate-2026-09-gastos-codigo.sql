-- =====================================================================
-- MIGRACIÓN (MariaDB/InnoDB) — código administrativo persistido de Gastos: GASTO-<id, mínimo 6 dígitos>
-- FASE A / EXPAND — se ejecuta ANTES del merge/deploy de la app nueva.
-- Archivo: sql/migrate-2026-09-gastos-codigo.sql   (la FASE B es sql/migrate-2026-09-gastos-codigo-finalizar.sql)
--
-- NO SE EJECUTA AUTOMÁTICAMENTE. Ejecutar manualmente (phpMyAdmin) DESPUÉS de revisar sql/preflight-2026-09-gastos-codigo.sql.
--
-- Estrategia expand/contract SIN ventana de fallo:
--   FASE A (este archivo)  : ADD codigo NULLABLE + backfill + UNIQUE (empresa_id, codigo). La columna QUEDA NULLABLE.
--   deploy de la app nueva
--   FASE B (finalizar)     : re-backfill de lo que la app vieja haya creado con NULL + validar + NOT NULL.
--
-- Por qué la app VIEJA sigue funcionando después de esta fase:
--   * su SELECT no pide `codigo` (no hay SELECT * sobre esta tabla) -> no le afecta la columna nueva;
--   * su INSERT no manda `codigo` -> la fila queda con codigo NULL, válido porque la columna es NULLABLE;
--   * el UNIQUE compuesto (empresa_id, codigo) permite VARIAS filas con codigo NULL (en InnoDB/MariaDB los NULL no se consideran iguales);
--   * listar / editar / autorizar / desactivar no cambian.
-- Y la app NUEVA con esta fase: `g.codigo` ya existe; los históricos ya tienen código; una fila creada por la app vieja con NULL se
-- muestra sin código (mapRow -> "", PDF sin código, archivo por id, listado "Gasto #id") sin romper nada.
--
-- Regla del código (IDÉNTICA a String(id).padStart(6, "0") de la app): mínimo 6 dígitos, NUNCA se trunca:
--   1 -> GASTO-000001 · 55 -> GASTO-000055 · 123456 -> GASTO-123456 · 1234567 -> GASTO-1234567
--   (por eso NO se usa LPAD(id, 6, '0') directo: LPAD trunca a 6 caracteres).
-- NO hace: DROP, DELETE, TRUNCATE, cambios de id, ni NOT NULL (eso es la fase B).
-- =====================================================================

SET @db := DATABASE();
-- Expresión ÚNICA del código (la misma en preflight, fase A, fase B y postchecks).
SET @cod := 'CONCAT(''GASTO-'', CASE WHEN CHAR_LENGTH(CAST(id AS CHAR)) < 6 THEN LPAD(CAST(id AS CHAR), 6, ''0'') ELSE CAST(id AS CHAR) END)';

-- ------------------------------ PRECHECK ------------------------------
SET @tabla := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos');
SET @sql := IF(@tabla = 1,
  CONCAT('SELECT SUM(id <= 0), MAX(CHAR_LENGTH(', @cod, ')) INTO @ids_invalidos, @codigo_max_largo FROM tms_gastos_operativos'),
  'SELECT 0, 0 INTO @ids_invalidos, @codigo_max_largo');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @motivo := CASE
  WHEN @tabla <> 1                          THEN 'la tabla tms_gastos_operativos no existe'
  WHEN COALESCE(@ids_invalidos, 0) <> 0     THEN 'hay ids no válidos (<= 0)'
  WHEN COALESCE(@codigo_max_largo, 0) > 30  THEN 'algún código superaría los 30 caracteres de VARCHAR(30)'
  ELSE NULL END;

SELECT IF(@motivo IS NULL, 'PRECHECK OK: se ejecutarán los pasos pendientes', CONCAT('DETENER: ', @motivo, ' — NO se modificó nada')) AS precheck,
       @tabla AS tabla, @ids_invalidos AS ids_invalidos, @codigo_max_largo AS codigo_max_largo;

-- ------------------------------ PASO 1: columna NULLABLE (solo si no existe) ------------------------------
SET @sql := IF(@motivo IS NULL
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') = 0,
  'ALTER TABLE tms_gastos_operativos ADD COLUMN codigo VARCHAR(30) NULL AFTER id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ PASO 2: backfill de históricos ------------------------------
-- actualizado_en = actualizado_en evita que el backfill cambie la fecha de "última actualización" de los gastos.
SET @sql := IF(@motivo IS NULL
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') = 1,
  CONCAT('UPDATE tms_gastos_operativos SET codigo = ', @cod, ', actualizado_en = actualizado_en WHERE codigo IS NULL OR codigo = ''''' ),
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ PASO 3: validar antes del UNIQUE ------------------------------
SET @inconsistentes := NULL, @duplicados := NULL;
SET @sql := IF(@motivo IS NULL,
  CONCAT('SELECT (SELECT COUNT(*) FROM tms_gastos_operativos WHERE codigo IS NOT NULL AND codigo <> ', @cod, '),
                 (SELECT COUNT(*) FROM (SELECT 1 FROM tms_gastos_operativos WHERE codigo IS NOT NULL GROUP BY empresa_id, codigo HAVING COUNT(*) > 1) d)
            INTO @inconsistentes, @duplicados'),
  'SELECT NULL, NULL INTO @inconsistentes, @duplicados');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @motivo2 := CASE
  WHEN @motivo IS NOT NULL                THEN @motivo
  WHEN COALESCE(@inconsistentes, 1) <> 0  THEN 'hay códigos distintos de GASTO-<id> entre los no nulos'
  WHEN COALESCE(@duplicados, 1) <> 0      THEN 'existen códigos duplicados por empresa'
  ELSE NULL END;

SELECT IF(@motivo2 IS NULL, 'VALIDACIÓN OK: se agrega el UNIQUE', CONCAT('DETENER: ', @motivo2, ' — NO se agregó el UNIQUE')) AS validacion,
       @inconsistentes AS codigos_inconsistentes, @duplicados AS grupos_duplicados;

-- ------------------------------ PASO 4: UNIQUE (empresa_id, codigo) — la columna SIGUE nullable ------------------------------
SET @sql := IF(@motivo2 IS NULL
    AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND INDEX_NAME = 'uq_gastos_empresa_codigo') = 0,
  'ALTER TABLE tms_gastos_operativos ADD UNIQUE KEY uq_gastos_empresa_codigo (empresa_id, codigo)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ POSTCHECK ------------------------------
SHOW COLUMNS FROM tms_gastos_operativos LIKE 'codigo';   -- esperado: Null = YES (la fase B la vuelve NOT NULL)
SHOW INDEX FROM tms_gastos_operativos WHERE Key_name = 'uq_gastos_empresa_codigo';

SET @col_final := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo');
SET @sql := IF(@col_final = 1,
  CONCAT('SELECT COUNT(*) AS gastos_totales,
                 SUM(codigo IS NULL OR codigo = '''') AS sin_codigo,
                 SUM(codigo IS NOT NULL AND codigo <> ', @cod, ') AS inconsistentes,
                 COUNT(DISTINCT empresa_id, codigo) AS codigos_distintos_por_empresa
            FROM tms_gastos_operativos'),
  'SELECT ''la columna codigo no existe (la migración no se aplicó)'' AS resultado');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

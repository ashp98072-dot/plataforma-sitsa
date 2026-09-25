-- =====================================================================
-- MIGRACIÓN (MariaDB/InnoDB) — código administrativo persistido de Gastos: GASTO-<id con 6 dígitos>
-- Archivo: sql/migrate-2026-09-gastos-codigo.sql
--
-- NO SE EJECUTA AUTOMÁTICAMENTE. Ejecutar manualmente (phpMyAdmin) DESPUÉS de revisar sql/preflight-2026-09-gastos-codigo.sql.
--
-- Estrategia por pasos (cada paso solo corre si el PRECHECK pasó y es necesario, así que puede re-ejecutarse tras un corte):
--   1) ADD COLUMN codigo VARCHAR(30) NULL (justo después de id)
--   2) BACKFILL de históricos:  codigo = CONCAT('GASTO-', LPAD(id, 6, '0'))  solo donde codigo IS NULL.
--      Se asigna actualizado_en = actualizado_en para que el backfill NO cambie la fecha de "última actualización" de los gastos.
--   3) VALIDAR: ningún gasto sin código y ningún duplicado por empresa; si no, se DETIENE antes de endurecer.
--   4) MODIFY codigo NOT NULL
--   5) ADD UNIQUE uq_gastos_empresa_codigo (empresa_id, codigo)
-- El id AUTO_INCREMENT es la fuente del código (igual que FONDO-000055); no hay correlativo aparte.
-- NO hace: DROP, DELETE, cambios de id, ni toca ninguna otra columna o tabla.
--
-- Orden de despliegue: la app nueva escribe y lee `codigo`. Aplicar esta migración justo antes/junto con el despliegue de la app
-- (ver reporte del PR): con la app nueva sin migración, crear/listar gastos falla; con la migración y la app antigua, crear gastos falla.
-- =====================================================================

SET @db := DATABASE();

-- ------------------------------ PRECHECK ------------------------------
SET @tabla := (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos');
SET @sql := IF(@tabla = 1,
  'SELECT SUM(id <= 0), SUM(id > 999999), SUM(CHAR_LENGTH(CONCAT(''GASTO-'', LPAD(id, 6, ''0''))) > 30) INTO @ids_invalidos, @ids_grandes, @codigos_largos FROM tms_gastos_operativos',
  'SELECT 0, 0, 0 INTO @ids_invalidos, @ids_grandes, @codigos_largos');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @motivo := CASE
  WHEN @tabla <> 1                        THEN 'la tabla tms_gastos_operativos no existe'
  WHEN COALESCE(@ids_invalidos, 0) <> 0   THEN 'hay ids no válidos (<= 0)'
  -- LPAD trunca a 6 caracteres: un id de 7+ dígitos produciría un código distinto del que genera la aplicación (padStart no trunca).
  WHEN COALESCE(@ids_grandes, 0) <> 0     THEN 'hay ids de más de 6 dígitos (LPAD truncaría el código)'
  WHEN COALESCE(@codigos_largos, 0) <> 0  THEN 'algún código superaría los 30 caracteres'
  ELSE NULL END;

SELECT IF(@motivo IS NULL, 'PRECHECK OK: se ejecutarán los pasos pendientes', CONCAT('DETENER: ', @motivo, ' — NO se modificó nada')) AS precheck,
       @tabla AS tabla, @ids_invalidos AS ids_invalidos, @ids_grandes AS ids_grandes, @codigos_largos AS codigos_largos;

-- ------------------------------ PASO 1: columna nullable ------------------------------
SET @sql := IF(@motivo IS NULL
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') = 0,
  'ALTER TABLE tms_gastos_operativos ADD COLUMN codigo VARCHAR(30) NULL AFTER id',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ PASO 2: backfill de históricos ------------------------------
SET @sql := IF(@motivo IS NULL
    AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') = 1,
  'UPDATE tms_gastos_operativos SET codigo = CONCAT(''GASTO-'', LPAD(id, 6, ''0'')), actualizado_en = actualizado_en WHERE codigo IS NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ PASO 3: validar antes de endurecer ------------------------------
SET @pendientes := NULL, @duplicados := NULL;
SET @sql := IF(@motivo IS NULL,
  'SELECT (SELECT COUNT(*) FROM tms_gastos_operativos WHERE codigo IS NULL OR codigo = ''''),
          (SELECT COUNT(*) FROM (SELECT 1 FROM tms_gastos_operativos GROUP BY empresa_id, codigo HAVING COUNT(*) > 1) d)
     INTO @pendientes, @duplicados',
  'SELECT NULL, NULL INTO @pendientes, @duplicados');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @motivo2 := CASE
  WHEN @motivo IS NOT NULL             THEN @motivo
  WHEN COALESCE(@pendientes, 1) <> 0   THEN 'quedaron gastos sin código tras el backfill'
  WHEN COALESCE(@duplicados, 1) <> 0   THEN 'existen códigos duplicados por empresa'
  ELSE NULL END;

SELECT IF(@motivo2 IS NULL, 'VALIDACIÓN OK: se endurece la columna', CONCAT('DETENER: ', @motivo2, ' — NO se aplicó NOT NULL ni UNIQUE')) AS validacion,
       @pendientes AS gastos_sin_codigo, @duplicados AS grupos_duplicados;

-- ------------------------------ PASO 4: NOT NULL ------------------------------
SET @sql := IF(@motivo2 IS NULL
    AND (SELECT IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') = 'YES',
  'ALTER TABLE tms_gastos_operativos MODIFY COLUMN codigo VARCHAR(30) NOT NULL',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ PASO 5: UNIQUE (empresa_id, codigo) ------------------------------
SET @sql := IF(@motivo2 IS NULL
    AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND INDEX_NAME = 'uq_gastos_empresa_codigo') = 0,
  'ALTER TABLE tms_gastos_operativos ADD UNIQUE KEY uq_gastos_empresa_codigo (empresa_id, codigo)',
  'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ------------------------------ POSTCHECK ------------------------------
SHOW COLUMNS FROM tms_gastos_operativos LIKE 'codigo';
SHOW INDEX FROM tms_gastos_operativos WHERE Key_name = 'uq_gastos_empresa_codigo';

-- Resumen: sin códigos vacíos, todos con el formato esperado, ninguno distinto de GASTO-<id> en históricos.
SET @col_final := (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo');
SET @sql := IF(@col_final = 1,
  'SELECT COUNT(*) AS gastos_totales,
          SUM(codigo IS NULL OR codigo = '''') AS sin_codigo,
          SUM(codigo <> CONCAT(''GASTO-'', LPAD(id, 6, ''0''))) AS distintos_de_gasto_id,
          COUNT(DISTINCT empresa_id, codigo) AS codigos_distintos_por_empresa
     FROM tms_gastos_operativos',
  'SELECT ''la columna codigo no existe (la migración no se aplicó)'' AS resultado');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

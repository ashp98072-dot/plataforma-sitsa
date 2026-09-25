-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — código administrativo persistido de Gastos (GASTO-000055)
-- Archivo: sql/preflight-2026-09-gastos-codigo.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de sql/migrate-2026-09-gastos-codigo.sql.
-- Regla del código: GASTO-<id con 6 dígitos> (igual que FONDO-000055). LPAD TRUNCA si el id tiene más de 6 dígitos:
-- por eso se exige que ningún id supere 999999 (ver bloque 3).
-- =====================================================================

-- 1) Entorno y estructura actual (informativo)
SELECT VERSION() AS version_bd,
       (SELECT COUNT(*) FROM information_schema.TABLES  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos') AS tabla_existe,
       (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos' AND COLUMN_NAME = 'codigo') AS columna_codigo_existe,
       (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos' AND INDEX_NAME = 'uq_gastos_empresa_codigo') AS indice_existe,
       (SELECT TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_gastos_operativos') AS colacion_tabla;

-- 2) Volumen a rellenar
SELECT COUNT(*) AS gastos_totales, COUNT(DISTINCT empresa_id) AS empresas, MIN(id) AS id_minimo, MAX(id) AS id_maximo
FROM tms_gastos_operativos;

-- 3) BLOQUEANTES (todas deben dar 0; si alguna da > 0, DETENER)
SELECT SUM(id <= 0)      AS ids_no_validos,
       SUM(id > 999999)  AS ids_de_mas_de_6_digitos,
       SUM(CHAR_LENGTH(CONCAT('GASTO-', LPAD(id, 6, '0'))) > 30) AS codigos_de_mas_de_30_caracteres
FROM tms_gastos_operativos;

-- 4) Duplicados que produciría el backfill por empresa (debe devolver 0 filas; el id es único, así que no debería haber)
SELECT empresa_id, CONCAT('GASTO-', LPAD(id, 6, '0')) AS codigo_resultante, COUNT(*) AS veces
FROM tms_gastos_operativos
GROUP BY empresa_id, CONCAT('GASTO-', LPAD(id, 6, '0'))
HAVING COUNT(*) > 1;

-- 5) Muestra de cómo quedarían los códigos (primeros y últimos)
(SELECT id, empresa_id, CONCAT('GASTO-', LPAD(id, 6, '0')) AS codigo_resultante FROM tms_gastos_operativos ORDER BY id ASC  LIMIT 5)
UNION ALL
(SELECT id, empresa_id, CONCAT('GASTO-', LPAD(id, 6, '0')) AS codigo_resultante FROM tms_gastos_operativos ORDER BY id DESC LIMIT 5);

-- =====================================================================
-- CRITERIO: si (1) muestra tabla_existe = 1, columna_codigo_existe = 0 e indice_existe = 0, y (3) da todo 0 y (4) sin filas,
-- se puede ejecutar sql/migrate-2026-09-gastos-codigo.sql. Si la columna o el índice ya existen (ejecución parcial previa), la
-- migración es idempotente por pasos y continúa donde quedó.
-- =====================================================================

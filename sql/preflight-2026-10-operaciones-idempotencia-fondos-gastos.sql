-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — idempotencia de creación: Solicitudes de Fondo y Gastos operativos (PR A)
-- Archivo: sql/preflight-2026-10-operaciones-idempotencia-fondos-gastos.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de
-- sql/migrate-2026-10-operaciones-idempotencia-fondos-gastos.sql.
--
-- ESQUEMA EXPLÍCITO: usa `TABLE_SCHEMA = 'u611730801_Plataforma'` y tablas calificadas; no depende de DATABASE() ni del
-- esquema activo de la sesión. Sin ROW_COUNT(). En otra base (pruebas), reemplazar el nombre del esquema en todo el archivo.
-- =====================================================================

-- 1) Entorno y existencia de las tablas (deben existir las dos).
SELECT VERSION() AS version_bd,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'tms_solicitudes_fondo') AS fondos_tabla_existe,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'tms_gastos_operativos') AS gastos_tabla_existe;

-- 2) Columnas/índices de idempotencia que YA existen (esperado ANTES de migrar: 0 columnas y 0 índices en ambas tablas;
--    esperado DESPUÉS: 2 columnas y 1 índice por tabla). Cualquier valor distinto ANTES = ejecución parcial o colisión de nombre.
SELECT t.tabla,
       (SELECT COUNT(*) FROM information_schema.COLUMNS c
         WHERE c.TABLE_SCHEMA = 'u611730801_Plataforma' AND c.TABLE_NAME = t.tabla
           AND c.COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia')) AS columnas_idempotencia,
       (SELECT COUNT(*) FROM information_schema.STATISTICS s
         WHERE s.TABLE_SCHEMA = 'u611730801_Plataforma' AND s.TABLE_NAME = t.tabla
           AND s.INDEX_NAME = t.indice) AS filas_indice_con_ese_nombre
FROM (SELECT 'tms_solicitudes_fondo' AS tabla, 'uq_fondo_empresa_clave' AS indice
      UNION ALL SELECT 'tms_gastos_operativos', 'uq_gastos_empresa_clave') t;

-- 3) Columnas con nombre PARECIDO (token/clave/idempotencia/huella/hash/request) en estas tablas: si aparece alguna, hay que
--    revisar a mano antes de agregar la nuestra (esperado: ninguna).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_gastos_operativos')
  AND (COLUMN_NAME LIKE '%idempot%' OR COLUMN_NAME LIKE '%token%' OR COLUMN_NAME LIKE '%clave%'
       OR COLUMN_NAME LIKE '%huella%' OR COLUMN_NAME LIKE '%hash%' OR COLUMN_NAME LIKE '%request%')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- 4) Índices UNIQUE actuales de las dos tablas (informativo; el nuevo no debe duplicar ninguno).
SELECT TABLE_NAME, INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_gastos_operativos')
  AND NON_UNIQUE = 0
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;

-- 5) Motor y colación de cada tabla (el UNIQUE requiere InnoDB; la colación es informativa).
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_gastos_operativos');

-- 6) Volumen (informativo): filas existentes que quedarán con clave NULL (histórico). La migración no las toca.
SELECT 'tms_solicitudes_fondo' AS tabla, COUNT(*) AS filas, COUNT(DISTINCT empresa_id) AS empresas
FROM u611730801_Plataforma.tms_solicitudes_fondo
UNION ALL
SELECT 'tms_gastos_operativos', COUNT(*), COUNT(DISTINCT empresa_id)
FROM u611730801_Plataforma.tms_gastos_operativos;

-- 7) COMPUERTA: 'LISTO PARA MIGRAR' solo si las dos tablas existen y no hay columnas ni índices con esos nombres.
SELECT IF(
         (SELECT COUNT(*) FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_gastos_operativos')) = 2
         AND (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_gastos_operativos')
                 AND COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia')) = 0
         AND (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME IN ('tms_solicitudes_fondo', 'tms_gastos_operativos')
                 AND INDEX_NAME IN ('uq_fondo_empresa_clave', 'uq_gastos_empresa_clave')) = 0,
         'LISTO PARA MIGRAR',
         'REVISAR: tablas ausentes, o ya existen columnas/índices de idempotencia (¿migración parcial o ya aplicada?)') AS compuerta;

-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — idempotencia de creación: Requerimientos de Compras (PR B)
-- Archivo: sql/preflight-2026-10-compras-idempotencia-requerimientos.sql
--
-- NO modifica nada: solo SELECT. Ejecutar manualmente y revisar ANTES de
-- sql/migrate-2026-10-compras-idempotencia-requerimientos.sql.
--
-- ESQUEMA EXPLÍCITO: usa `TABLE_SCHEMA = 'u611730801_Plataforma'` y tablas calificadas; no depende de DATABASE() ni del
-- esquema activo de la sesión. Sin ROW_COUNT(). En otra base (pruebas), reemplazar el nombre del esquema en todo el archivo.
-- =====================================================================

-- 1) Entorno y existencia de las tablas (deben existir las dos).
SELECT VERSION() AS version_bd,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos') AS requerimientos_tabla_existe,
       (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimiento_lineas') AS lineas_tabla_existe;

-- 2) Columnas/índice de idempotencia que YA existen (esperado ANTES de migrar: 0 columnas y 0 filas de índice;
--    esperado DESPUÉS: 2 columnas y 2 filas de índice —una por columna—). Cualquier otro valor ANTES = ejecución parcial o
--    colisión de nombre.
SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
           AND COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia')) AS columnas_idempotencia,
       (SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
           AND INDEX_NAME = 'uq_compras_req_empresa_clave') AS filas_indice_con_ese_nombre;

-- 3) Columnas con nombre PARECIDO (token/clave/idempotencia/huella/hash/request) en la tabla: si aparece alguna, revisar a mano
--    antes de agregar la nuestra (esperado: ninguna).
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
  AND TABLE_NAME = 'compras_requerimientos'
  AND (COLUMN_NAME LIKE '%idempot%' OR COLUMN_NAME LIKE '%token%' OR COLUMN_NAME LIKE '%clave%'
       OR COLUMN_NAME LIKE '%huella%' OR COLUMN_NAME LIKE '%hash%' OR COLUMN_NAME LIKE '%request%')
ORDER BY COLUMN_NAME;

-- 4) Índices UNIQUE actuales de la tabla (informativo; el nuevo no debe duplicar ninguno).
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos' AND NON_UNIQUE = 0
GROUP BY INDEX_NAME
ORDER BY INDEX_NAME;

-- 5) Motor y colación (el UNIQUE requiere InnoDB; la colación es informativa).
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos';

-- 6) Volumen (informativo): filas existentes que quedarán con clave NULL (histórico). La migración no las toca.
SELECT COUNT(*) AS requerimientos, COUNT(DISTINCT empresa_id) AS empresas
FROM u611730801_Plataforma.compras_requerimientos;

-- 7) COMPUERTA: 'LISTO PARA MIGRAR' solo si las dos tablas existen y no hay columnas ni índice con esos nombres.
SELECT IF(
         (SELECT COUNT(*) FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
             AND TABLE_NAME IN ('compras_requerimientos', 'compras_requerimiento_lineas')) = 2
         AND (SELECT COUNT(*) FROM information_schema.COLUMNS
               WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
                 AND COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia')) = 0
         AND (SELECT COUNT(*) FROM information_schema.STATISTICS
               WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
                 AND INDEX_NAME = 'uq_compras_req_empresa_clave') = 0,
         'LISTO PARA MIGRAR',
         'REVISAR: tablas ausentes, o ya existen columnas/índice de idempotencia (¿migración parcial o ya aplicada?)') AS compuerta;

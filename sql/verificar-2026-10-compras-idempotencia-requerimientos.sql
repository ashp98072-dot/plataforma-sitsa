-- =====================================================================
-- VERIFICACIÓN POSTERIOR (SOLO LECTURA) — idempotencia de creación: Requerimientos de Compras (PR B)
-- Archivo: sql/verificar-2026-10-compras-idempotencia-requerimientos.sql
--
-- NO modifica nada: solo SELECT. Ejecutar DESPUÉS de sql/migrate-2026-10-compras-idempotencia-requerimientos.sql.
-- ESQUEMA EXPLÍCITO `u611730801_Plataforma`; sin DATABASE() ni ROW_COUNT().
-- =====================================================================

-- 1) Estructura: 2 columnas nuevas, ambas NULL permitido, con el tipo esperado.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
  AND COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia')
ORDER BY COLUMN_NAME;

-- 2) Índice: UNIQUE sobre (empresa_id, clave_idempotencia), en ese orden.
SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
  AND INDEX_NAME = 'uq_compras_req_empresa_clave'
GROUP BY INDEX_NAME, NON_UNIQUE;

-- 3) Resumen con compuerta (OK solo si la estructura es la esperada).
SELECT
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
      AND COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia') AND IS_NULLABLE = 'YES') AS columnas_nuevas_nullables,
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
      AND INDEX_NAME = 'uq_compras_req_empresa_clave' AND NON_UNIQUE = 0
      AND ((SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'empresa_id') OR (SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'clave_idempotencia'))) AS columnas_del_indice_ok,
  IF((SELECT COUNT(*) FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
         AND COLUMN_NAME IN ('clave_idempotencia', 'huella_idempotencia') AND IS_NULLABLE = 'YES') = 2
     AND (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'compras_requerimientos'
             AND INDEX_NAME = 'uq_compras_req_empresa_clave' AND NON_UNIQUE = 0
             AND ((SEQ_IN_INDEX = 1 AND COLUMN_NAME = 'empresa_id') OR (SEQ_IN_INDEX = 2 AND COLUMN_NAME = 'clave_idempotencia'))) = 2,
     'ESTRUCTURA OK', 'REVISAR ESTRUCTURA') AS estructura;

-- 4) Datos: la migración NO debe haber tocado históricos (esperado: con_clave = 0 justo después de migrar, antes de que el
--    código nuevo cree requerimientos) y nunca debe haber una clave sin huella.
SELECT COUNT(*) AS requerimientos,
       SUM(clave_idempotencia IS NOT NULL) AS con_clave,
       SUM(clave_idempotencia IS NOT NULL AND huella_idempotencia IS NULL) AS clave_sin_huella,
       SUM(clave_idempotencia IS NULL AND huella_idempotencia IS NOT NULL) AS huella_sin_clave
FROM u611730801_Plataforma.compras_requerimientos;

-- 5) Integridad (debe devolver 0 filas): ninguna pareja (empresa, clave) repetida — el UNIQUE lo garantiza; se comprueba igual.
SELECT empresa_id, clave_idempotencia, COUNT(*) AS veces
FROM u611730801_Plataforma.compras_requerimientos
WHERE clave_idempotencia IS NOT NULL
GROUP BY empresa_id, clave_idempotencia
HAVING COUNT(*) > 1;

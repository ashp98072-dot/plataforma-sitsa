-- PROPUESTA DE VERIFICACIÓN, NO EJECUTADA POR ESTA RAMA/PR.
-- Solo lectura. No modifica datos ni estructura.
--
-- Ejecutar ANTES de sql/migrate-2026-09-rrhh-prestaciones-codigo-concepto.sql
-- y leer el resultado con cuidado:
--
-- A) `rrhh_prestaciones` existe, `codigo_concepto` NO aparece en el bloque de
--    columnas -> aplicar la migración, es aditiva y segura.
-- B) `codigo_concepto` YA aparece con COLUMN_TYPE = 'varchar(40)' e
--    IS_NULLABLE = 'YES' -> la migración es NO-OP (ADD COLUMN IF NOT EXISTS
--    no hace nada), no hace falta ejecutarla, pero tampoco daña ejecutarla.
-- C) `codigo_concepto` YA existe con un tipo/nulabilidad DISTINTO (por
--    ejemplo NOT NULL, otro tamaño, otro tipo) -> NO ejecutar la migración.
--    ADD COLUMN IF NOT EXISTS de MariaDB no valida la definición existente,
--    solo omite el ADD si el nombre ya existe — en este caso detenerse y
--    revisar manualmente antes de continuar; nunca asumir que coincide.

SELECT VERSION() AS version_servidor;

-- Estado automático: un solo veredicto en texto, para no depender de que el
-- operador deduzca el caso leyendo information_schema a mano.
--   APLICAR — la tabla existe y `codigo_concepto` todavía no existe.
--   NOOP    — `codigo_concepto` ya existe exactamente como varchar(40) NULL.
--   DETENER — la tabla no existe, o `codigo_concepto` existe con una
--             definición distinta (tipo/tamaño/nulabilidad). No ejecutar
--             la migración en este caso; revisar manualmente primero.
SELECT
  CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_prestaciones'
    ) THEN 'DETENER'
    WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_prestaciones'
        AND COLUMN_NAME = 'codigo_concepto'
    ) THEN 'APLICAR'
    WHEN EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_prestaciones'
        AND COLUMN_NAME = 'codigo_concepto'
        AND COLUMN_TYPE = 'varchar(40)' AND IS_NULLABLE = 'YES'
    ) THEN 'NOOP'
    ELSE 'DETENER'
  END AS estado_migracion,
  (SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_prestaciones'
     AND COLUMN_NAME = 'codigo_concepto') AS codigo_concepto_tipo_actual,
  (SELECT IS_NULLABLE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rrhh_prestaciones'
     AND COLUMN_NAME = 'codigo_concepto') AS codigo_concepto_nullable_actual;

-- Existencia, engine y collation de la tabla.
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'rrhh_prestaciones';

SHOW CREATE TABLE rrhh_prestaciones;

-- Columna `tipo` (label libre existente, referencia de posición para el AFTER)
-- y, si ya existe, `codigo_concepto` (caso B o C de arriba).
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, ORDINAL_POSITION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'rrhh_prestaciones'
  AND COLUMN_NAME IN ('tipo', 'codigo_concepto')
ORDER BY ORDINAL_POSITION;

-- Volumen total — el ALTER es aditivo, pero eso no garantiza por sí solo
-- cómo lo ejecuta el servidor: revisar volumen y condiciones operativas
-- antes de ejecutarlo; el algoritmo/locking efectivo depende de la versión
-- de MariaDB/InnoDB y del estado de la tabla en ese momento, no se promete
-- aquí "sin reescritura" ni un ALGORITHM/LOCK específico.
SELECT COUNT(*) AS total_filas FROM rrhh_prestaciones;

-- Confirmar que NO se requiere backfill: no se puede referenciar
-- `codigo_concepto` en una consulta si la columna todavía no existe (SQL no
-- permite condicionar eso en tiempo de ejecución sin procedimientos), así
-- que este paso es manual:
--   - Si el bloque de columnas de arriba NO muestra `codigo_concepto`:
--     no hay nada que contar — todas las filas quedarán NULL tras la
--     migración, sin excepción. No ejecutar nada más aquí.
--   - Si el bloque de columnas de arriba SÍ muestra `codigo_concepto`
--     (caso B o C): ejecutar aparte
--       SELECT COUNT(*) AS filas_con_codigo_concepto_no_nulo
--       FROM rrhh_prestaciones WHERE codigo_concepto IS NOT NULL;
--     Se espera 0. Cualquier valor distinto de 0 significa que algo ya
--     escribió en esa columna fuera de este PR — detenerse y entender el
--     origen antes de continuar; este PR no hace backfill bajo ninguna
--     circunstancia y no asume que ese valor previo sea correcto.

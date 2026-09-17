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

-- Volumen total — para dimensionar el ALTER (aditivo, sin reescritura de
-- filas al no llevar DEFAULT distinto de NULL, pero útil para confirmar
-- alcance antes de tocar producción).
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

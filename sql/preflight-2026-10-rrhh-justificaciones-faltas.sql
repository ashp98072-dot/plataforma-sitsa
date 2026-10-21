-- RRHH — Justificación de faltas — PREFLIGHT (SOLO LECTURA; NO ejecutado por este PR).
-- Verifica dependencias de sql/migrate-2026-10-rrhh-justificaciones-faltas.sql.
--
-- BASE DESTINO: u611730801_Plataforma. Este script NO depende de la base seleccionada ni de variables de sesión:
--   · toda consulta a information_schema filtra por el literal 'u611730801_Plataforma' (nunca por DATABASE());
--   · todo SHOW usa el nombre calificado u611730801_Plataforma.<tabla>.
-- Así, ejecutarlo con `information_schema` (o cualquier otra base) seleccionada NO produce una lectura falsa: devuelve el
-- resultado de la base destino o, si esa base/tablas no existen, un resultado vacío / «DETENER».
-- Para otra instalación: buscar y reemplazar TODAS las apariciones de u611730801_Plataforma por el nombre de esa base.
-- Ejecutar de arriba hacia abajo; cada bloque es independiente.

-- 0) GUARDA DE CONTEXTO. `base_seleccionada` es la base activa de la sesión (informativo); `decision_contexto` debe ser OK
--    antes de ejecutar la MIGRACIÓN (que usa nombres sin esquema). Si dice DETENER: seleccionar u611730801_Plataforma y repetir.
SELECT DATABASE() AS base_seleccionada,
       'u611730801_Plataforma' AS base_esperada,
       VERSION() AS version_servidor,
       IF(DATABASE() <=> 'u611730801_Plataforma', 'OK',
          'DETENER: selecciona la base u611730801_Plataforma (no information_schema ni otra) antes de migrar') AS decision_contexto;

-- 1) La base destino existe y tiene las dependencias (deben ser InnoDB; id INT no unsigned).
SELECT SCHEMA_NAME AS base_destino_existe FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'u611730801_Plataforma';
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME IN ('empresas', 'empleados', 'documentos_empleados');
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME IN ('empresas', 'empleados') AND COLUMN_NAME IN ('id', 'empresa_id')
 ORDER BY TABLE_NAME, COLUMN_NAME;

-- 2) ÍNDICE PADRE de la FK compuesta: `empleados` debe tener un UNIQUE (empresa_id, id), en ESE orden (el nombre no importa;
--    producción: uq_multas_empleado_empresa_id, schema.sql: uq_ruta_personal_empresa_id). Esta migración NO lo crea.
--    Esperado: al menos 1 fila. 0 filas = DETENER (no hacer ALTER a empleados desde aquí; devolver la decisión).
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas, MIN(NON_UNIQUE) AS non_unique
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'empleados'
 GROUP BY INDEX_NAME
HAVING MIN(NON_UNIQUE) = 0 AND columnas = 'empresa_id,id';
-- Lectura directa equivalente (sin information_schema):
SHOW INDEX FROM u611730801_Plataforma.empleados;
SHOW CREATE TABLE u611730801_Plataforma.empleados;

-- 3) ¿Ya existe la tabla? (0 filas = APLICAR; 1 fila = ya aplicada: la migración es NOOP; comparar SHOW CREATE TABLE).
SHOW TABLES FROM u611730801_Plataforma LIKE 'rrhh_asistencia_justificaciones';
SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'rrhh_asistencia_justificaciones';

-- 4) Conflictos de nombres de constraints (deben estar ausentes salvo que la tabla ya exista íntegra).
SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma' AND CONSTRAINT_NAME IN
 ('uq_asist_just', 'fk_asist_just_empresa', 'fk_asist_just_empleado', 'ck_asist_just_estado', 'ck_asist_just_version',
  'ck_asist_just_tipo', 'ck_asist_just_reversion');

-- 5) Decisión (no depende de la base seleccionada). OK solo si: la base destino existe; empresas y empleados son InnoDB con
--    id INT no unsigned; empleados.empresa_id es INT no unsigned; y existe UNIQUE (empresa_id, id) en empleados.
SELECT CASE WHEN
  (SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = 'u611730801_Plataforma') = 1
  AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
         AND TABLE_NAME IN ('empresas', 'empleados') AND ENGINE = 'InnoDB') = 2
  AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'u611730801_Plataforma'
         AND ((TABLE_NAME IN ('empresas', 'empleados') AND COLUMN_NAME = 'id')
              OR (TABLE_NAME = 'empleados' AND COLUMN_NAME = 'empresa_id'))
         AND DATA_TYPE = 'int' AND COLUMN_TYPE NOT LIKE '%unsigned%') = 3
  AND EXISTS (SELECT 1 FROM (
        SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnas, MIN(NON_UNIQUE) AS non_unique
          FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'empleados'
         GROUP BY INDEX_NAME) i
       WHERE i.non_unique = 0 AND i.columnas = 'empresa_id,id')
  THEN 'OK' ELSE 'DETENER' END AS decision;

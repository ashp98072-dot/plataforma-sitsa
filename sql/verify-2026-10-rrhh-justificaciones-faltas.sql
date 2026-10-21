-- RRHH — Justificación de faltas — VERIFY (SOLO LECTURA; ejecutar DESPUÉS de migrar).
--
-- BASE DESTINO: u611730801_Plataforma. No depende de la base seleccionada ni de variables de sesión: toda consulta a
-- information_schema filtra por el literal 'u611730801_Plataforma' y todo SHOW usa nombres calificados. Ejecutado con
-- `information_schema` seleccionada NO da una lectura falsa. Para otra instalación, reemplazar el literal en TODAS las líneas.

-- 0) Guarda de contexto (informativa; este script no la necesita para ser correcto).
SELECT DATABASE() AS base_seleccionada, 'u611730801_Plataforma' AS base_esperada,
       IF(DATABASE() <=> 'u611730801_Plataforma', 'OK', 'AVISO: otra base seleccionada; las consultas siguientes igual apuntan a la esperada') AS contexto;

-- 1) Estructura creada.
SHOW CREATE TABLE u611730801_Plataforma.rrhh_asistencia_justificaciones;
SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
 WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'rrhh_asistencia_justificaciones';
-- La migración no inserta datos: esperado 0 en una instalación nueva.
SELECT COUNT(*) AS filas FROM u611730801_Plataforma.rrhh_asistencia_justificaciones;

-- 2) FK TENANT-SAFE: debe existir fk_asist_just_empleado COMPUESTA (empresa_id, empleado_id) → empleados(empresa_id, id).
--    Esperado: 2 filas (ORDINAL_POSITION 1 = empresa_id→empresa_id, 2 = empleado_id→id). Con 1 fila o sin esta FK, la
--    estructura NO es tenant-safe: DETENER.
SELECT CONSTRAINT_NAME, ORDINAL_POSITION, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
  FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'rrhh_asistencia_justificaciones'
   AND CONSTRAINT_NAME = 'fk_asist_just_empleado'
 ORDER BY ORDINAL_POSITION;
SELECT CONSTRAINT_NAME, TABLE_NAME, REFERENCED_TABLE_NAME, UPDATE_RULE, DELETE_RULE
  FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'rrhh_asistencia_justificaciones'
 ORDER BY CONSTRAINT_NAME;
SELECT CASE WHEN
  (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = 'u611730801_Plataforma' AND TABLE_NAME = 'rrhh_asistencia_justificaciones'
      AND CONSTRAINT_NAME = 'fk_asist_just_empleado' AND REFERENCED_TABLE_NAME = 'empleados'
      AND ((ORDINAL_POSITION = 1 AND COLUMN_NAME = 'empresa_id' AND REFERENCED_COLUMN_NAME = 'empresa_id')
        OR (ORDINAL_POSITION = 2 AND COLUMN_NAME = 'empleado_id' AND REFERENCED_COLUMN_NAME = 'id'))) = 2
  THEN 'OK' ELSE 'DETENER: la FK de empleado no es compuesta por empresa' END AS decision_fk_tenant;

-- 3) CHECKs (la asociación a tabla proviene de TABLE_CONSTRAINTS, nunca de cc.TABLE_NAME). Esperado: 4 checks ck_asist_just_*.
SELECT tc.TABLE_NAME, cc.CONSTRAINT_NAME, cc.CHECK_CLAUSE
  FROM information_schema.TABLE_CONSTRAINTS tc
  JOIN information_schema.CHECK_CONSTRAINTS cc ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 WHERE tc.CONSTRAINT_SCHEMA = 'u611730801_Plataforma' AND tc.TABLE_NAME = 'rrhh_asistencia_justificaciones' AND tc.CONSTRAINT_TYPE = 'CHECK'
 ORDER BY cc.CONSTRAINT_NAME;

-- 4) Auditoría de datos. La FK compuesta y los CHECKs ya IMPIDEN el cruce de tenant, un estado fuera de dominio y una
--    reversión incompleta; estas consultas solo detectan filas que hubieran entrado con las restricciones deshabilitadas
--    (foreign_key_checks=0 / importaciones fuera de la aplicación). Cada una debe devolver 0 filas.
SELECT j.id, 'empleado_de_otra_empresa_o_inexistente' AS problema
  FROM u611730801_Plataforma.rrhh_asistencia_justificaciones j
  LEFT JOIN u611730801_Plataforma.empleados e ON e.empresa_id = j.empresa_id AND e.id = j.empleado_id
 WHERE e.id IS NULL;
SELECT id, 'estado_fuera_de_dominio' AS problema FROM u611730801_Plataforma.rrhh_asistencia_justificaciones
 WHERE estado NOT IN ('ACTIVA', 'REVERTIDA');
SELECT id, 'reversion_inconsistente' AS problema FROM u611730801_Plataforma.rrhh_asistencia_justificaciones
 WHERE (estado = 'REVERTIDA' AND (revertido_por IS NULL OR revertido_en IS NULL OR motivo_reversion IS NULL))
    OR (estado = 'ACTIVA' AND (revertido_por IS NOT NULL OR revertido_en IS NOT NULL OR motivo_reversion IS NOT NULL));
-- Invariante que NINGUNA restricción puede expresar (depende de otras tablas): justificación ACTIVA de una fecha anterior al alta
-- del empleado. Informativa: la aplicación solo permite justificar días que el reporte considera falta.
SELECT j.id, j.fecha, e.fecha_alta, 'activa_antes_del_alta' AS problema
  FROM u611730801_Plataforma.rrhh_asistencia_justificaciones j
  JOIN u611730801_Plataforma.empleados e ON e.empresa_id = j.empresa_id AND e.id = j.empleado_id
 WHERE j.estado = 'ACTIVA' AND e.fecha_alta IS NOT NULL AND j.fecha < e.fecha_alta;

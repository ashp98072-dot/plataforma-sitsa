-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — RESET CONTROLADO DEL MODULO DE VACACIONES
-- No ejecutado por Claude. Solo SELECT: no modifica nada. MariaDB 11.8.
-- Ejecutar sentencia por sentencia en la base REAL ANTES de considerar sql/propuesta-reset-vacaciones.sql (todo comentado)
-- y guardar los resultados como evidencia junto con el historial exportado ("Exportar historial actual").
--
-- Reglas que este preflight protege:
--   * NO se toca ninguna incidencia que no sea de tipo 'Vacaciones' / 'A cuenta de Vacaciones'.
--   * NO se toca empleados, solicitudes_vacaciones ni evidencias_incidencias sin decision previa.
--   * NO se usa TRUNCATE ni FOREIGN_KEY_CHECKS=0. Los borrados siempre llevan filtro por empresa y se verifican con conteos.
--   * NO se sobrescribe ni se borra backup_saldos_vacaciones_20261006 ni ningun respaldo existente.
--   * detalle_consumo_vacaciones.saldo_id / incidencia_id son ON DELETE CASCADE: el orden de borrado importa.
--   * Criterio de pareja vacaciones <-> incidencias = el mismo de "Exportar historial actual" (empresa + empleado + fecha_inicio +
--     fecha_fin + dias_habiles; tipo resuelto solo si hay tantas incidencias candidatas como filas y todas del mismo tipo).
--
-- PRECONDICION FUERTE: el RESET NO SE EJECUTA si existe CUALQUIERA de estos (secciones 4, 4b, 4c, 7, 8, 11 y 12):
--   incidencia de vacaciones con evidencia · incidencia con solicitud ligada · vacaciones sin incidencia · incidencias sin vacaciones ·
--   tipo ambiguo · duplicado identico no resuelto (el importador lo consolidaria: reimportar daria 1 sola fila) · export incompleto.
-- =====================================================================

-- 0) Conteos actuales (referencia segun la inspeccion: vacaciones 31, incidencias de vacaciones 31, detalle 35, saldos 441, solicitudes 0).
--    Usar los conteos REALES, no estos.
SELECT 'vacaciones' AS tabla, COUNT(*) AS filas FROM vacaciones
UNION ALL SELECT 'incidencias tipo Vacaciones', COUNT(*) FROM incidencias WHERE tipo = 'Vacaciones'
UNION ALL SELECT 'incidencias tipo A cuenta de Vacaciones', COUNT(*) FROM incidencias WHERE tipo = 'A cuenta de Vacaciones'
UNION ALL SELECT 'detalle_consumo_vacaciones', COUNT(*) FROM detalle_consumo_vacaciones
UNION ALL SELECT 'saldos_vacaciones', COUNT(*) FROM saldos_vacaciones
UNION ALL SELECT 'solicitudes_vacaciones', COUNT(*) FROM solicitudes_vacaciones
UNION ALL SELECT 'evidencias de incidencias de vacaciones', COUNT(*) FROM evidencias_incidencias ev JOIN incidencias i ON i.id = ev.incidencia_id WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
UNION ALL SELECT 'incidencias de OTROS tipos (NO SE TOCAN)', COUNT(*) FROM incidencias WHERE tipo NOT IN ('Vacaciones','A cuenta de Vacaciones')
UNION ALL SELECT 'empleados (NO SE TOCAN)', COUNT(*) FROM empleados;

-- 1) Respaldos existentes (NO deben sobrescribirse ni borrarse) y colision con los nombres que usara la propuesta (bk_reset_<TS>_*)
SELECT TABLE_NAME, TABLE_ROWS, CREATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'backup\_%' OR TABLE_NAME LIKE 'bk\_%')
ORDER BY TABLE_NAME;
-- Debe devolver backup_saldos_vacaciones_20261006 (intacto). Si ya existe alguna tabla bk_reset_<sello>_*, elegir otro sello.

-- 2) Incidencias por tipo — SOLO las de vacaciones se reconstruyen; las demas NO se tocan
SELECT tipo, COUNT(*) AS filas,
       CASE WHEN tipo IN ('Vacaciones','A cuenta de Vacaciones') THEN 'RECONSTRUIBLE' ELSE 'NO SE TOCA' END AS tratamiento
FROM incidencias GROUP BY tipo ORDER BY tratamiento, tipo;

-- 3) CUALQUIER FK QUE IMPIDA EL RESET: todo lo que referencia a las tablas que se borrarian, con su regla de borrado.
--    DELETE_RULE RESTRICT / NO ACTION = bloquea el borrado (resolver antes). CASCADE / SET NULL = se propaga (revisar que sea lo esperado:
--    detalle_consumo_vacaciones -> CASCADE; solicitudes_vacaciones.incidencia_id -> SET NULL; evidencias -> ver 8).
SELECT kcu.TABLE_NAME AS tabla_que_referencia, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME AS tabla_referenciada, rc.DELETE_RULE,
       CASE WHEN rc.DELETE_RULE IN ('RESTRICT','NO ACTION') THEN 'BLOQUEA EL RESET' ELSE 'se propaga' END AS efecto
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
  AND kcu.REFERENCED_TABLE_NAME IN ('incidencias', 'saldos_vacaciones', 'vacaciones', 'detalle_consumo_vacaciones')
ORDER BY kcu.REFERENCED_TABLE_NAME, kcu.TABLE_NAME;

-- 4) PAREJA vacaciones <-> incidencias, por grupo (empresa, empleado, inicio, fin, dias). Esperado: CERO filas.
--    VACACION_SIN_INCIDENCIA            filas en vacaciones sin ninguna incidencia candidata (tipo NO resoluble)
--    INCIDENCIA_SIN_VACACION            incidencias de vacaciones sin fila en vacaciones (no salen en el archivo exportado)
--    TIPO_AMBIGUO                       candidatas de AMBOS tipos para la misma llave
--    INCIDENCIAS_CANTIDAD_DISTINTA      n filas en vacaciones <> n incidencias candidatas
SELECT *
FROM (
  SELECT g.empresa_id, g.id_empleado, g.fecha_inicio, g.fecha_fin, g.dias_habiles,
         (SELECT COUNT(*) FROM vacaciones v WHERE v.empresa_id = g.empresa_id AND v.id_empleado = g.id_empleado AND v.fecha_inicio = g.fecha_inicio AND v.fecha_fin = g.fecha_fin AND v.dias_habiles = g.dias_habiles) AS n_vacaciones,
         (SELECT COUNT(*) FROM incidencias i WHERE i.empresa_id = g.empresa_id AND i.id_empleado = g.id_empleado AND i.fecha_inicio = g.fecha_inicio AND i.fecha_fin = g.fecha_fin AND i.dias_habiles = g.dias_habiles AND i.tipo = 'Vacaciones') AS n_inc_vacaciones,
         (SELECT COUNT(*) FROM incidencias i WHERE i.empresa_id = g.empresa_id AND i.id_empleado = g.id_empleado AND i.fecha_inicio = g.fecha_inicio AND i.fecha_fin = g.fecha_fin AND i.dias_habiles = g.dias_habiles AND i.tipo = 'A cuenta de Vacaciones') AS n_inc_a_cuenta
  FROM (
    SELECT empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles FROM vacaciones
    UNION
    SELECT empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles FROM incidencias WHERE tipo IN ('Vacaciones','A cuenta de Vacaciones')
  ) g
) x
WHERE NOT (n_vacaciones > 0 AND (n_inc_vacaciones = 0 OR n_inc_a_cuenta = 0) AND n_vacaciones = n_inc_vacaciones + n_inc_a_cuenta)
ORDER BY empresa_id, id_empleado, fecha_inicio;
-- Diagnostico de cada fila devuelta: n_vacaciones = 0 -> INCIDENCIA_SIN_VACACION; n_inc_vacaciones + n_inc_a_cuenta = 0 -> VACACION_SIN_INCIDENCIA;
-- ambos n_inc > 0 -> TIPO_AMBIGUO; n_vacaciones <> n_inc_vacaciones + n_inc_a_cuenta -> INCIDENCIAS_CANTIDAD_DISTINTA.

-- 4b) Vacaciones con estado distinto de 'Aprobado' (el export no las asume: esperado 0)
SELECT id, empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, estado FROM vacaciones WHERE LOWER(TRIM(estado)) <> 'aprobado';

-- 4c) DUPLICADOS IDENTICOS en vacaciones (misma llave empresa + empleado + inicio + fin + dias). Esperado: CERO filas.
--     El importador consolida estas filas (llave empleado + inicio + fin + dias + tipo): exportarlas y reimportarlas dejaria UNA sola, asi que el
--     archivo no seria una fuente sin perdida. Deben resolverse (toma real distinta o duplicado de datos) ANTES del reset.
SELECT v.empresa_id, v.id_empleado, v.fecha_inicio, v.fecha_fin, v.dias_habiles, COUNT(*) AS filas_identicas, GROUP_CONCAT(v.id ORDER BY v.id) AS vacaciones_ids
FROM vacaciones v
GROUP BY v.empresa_id, v.id_empleado, v.fecha_inicio, v.fecha_fin, v.dias_habiles
HAVING COUNT(*) > 1
ORDER BY v.empresa_id, v.id_empleado, v.fecha_inicio;

-- 5) DETALLE FIFO huerfano o inconsistente (todas esperadas en 0)
-- 5a) detalle cuya incidencia o cuyo saldo ya no existe (las FK en CASCADE deberian impedirlo)
SELECT 'detalle sin incidencia' AS problema, d.id FROM detalle_consumo_vacaciones d LEFT JOIN incidencias i ON i.id = d.incidencia_id WHERE i.id IS NULL
UNION ALL
SELECT 'detalle sin saldo', d.id FROM detalle_consumo_vacaciones d LEFT JOIN saldos_vacaciones s ON s.id = d.saldo_id WHERE s.id IS NULL;
-- 5b) detalle que apunta a incidencias que NO son de vacaciones (el borrado del detalle afectaria otro tipo)
SELECT d.id AS detalle_id, d.incidencia_id, i.tipo
FROM detalle_consumo_vacaciones d JOIN incidencias i ON i.id = d.incidencia_id
WHERE i.tipo NOT IN ('Vacaciones','A cuenta de Vacaciones');
-- 5c) detalle cuyo saldo pertenece a OTRO empleado o a OTRA empresa que su incidencia (fuga entre empleados/empresas)
SELECT d.id AS detalle_id, d.incidencia_id, d.saldo_id, i.empresa_id AS empresa_incidencia, s.empresa_id AS empresa_saldo, i.id_empleado AS empleado_incidencia, s.id_empleado AS empleado_saldo
FROM detalle_consumo_vacaciones d
JOIN incidencias i ON i.id = d.incidencia_id
JOIN saldos_vacaciones s ON s.id = d.saldo_id
WHERE i.empresa_id <> s.empresa_id OR i.id_empleado <> s.id_empleado;
-- 5d) incidencias de vacaciones SIN detalle FIFO (consumo que el reset no podria reconstruir desde el detalle)
SELECT i.id AS incidencia_id, i.empresa_id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles
FROM incidencias i
WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones') AND NOT EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.incidencia_id = i.id);
-- 5e) consumo del detalle <> dias de la incidencia (esperado 0 filas; si hay, el historial exportado no explica el detalle)
SELECT i.id AS incidencia_id, i.dias_habiles, SUM(d.dias_tomados) AS dias_en_detalle
FROM incidencias i JOIN detalle_consumo_vacaciones d ON d.incidencia_id = i.id
WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
GROUP BY i.id, i.dias_habiles HAVING ABS(i.dias_habiles - SUM(d.dias_tomados)) > 0.005;

-- 6) SALDOS CON CONSUMO (se borrarian con el reset; el detalle debe ir primero)
SELECT s.empresa_id, s.id_empleado, COUNT(DISTINCT s.id) AS saldos_con_consumo, COUNT(d.id) AS lineas_detalle, COALESCE(SUM(d.dias_tomados), 0) AS dias_consumidos
FROM saldos_vacaciones s JOIN detalle_consumo_vacaciones d ON d.saldo_id = s.id
GROUP BY s.empresa_id, s.id_empleado ORDER BY s.empresa_id, s.id_empleado;

-- 7) SOLICITUDES ACTIVAS / ligadas: NO se tocan sin decision previa (solicitudes_vacaciones.incidencia_id es ON DELETE SET NULL)
SELECT sv.id, sv.empresa_id, sv.id_empleado, sv.tipo, sv.estado, sv.fecha_inicio, sv.fecha_fin, sv.dias_habiles, sv.incidencia_id
FROM solicitudes_vacaciones sv
WHERE sv.estado IN ('Pendiente') OR sv.incidencia_id IS NOT NULL
ORDER BY sv.empresa_id, sv.id;

-- 8) EVIDENCIAS asociadas a incidencias de vacaciones (sus archivos viven en disco: NO se borran en cascada; si hay, el reset se bloquea)
SELECT ev.id AS evidencia_id, ev.empresa_id, ev.incidencia_id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin
FROM evidencias_incidencias ev JOIN incidencias i ON i.id = ev.incidencia_id
WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
ORDER BY ev.empresa_id, ev.incidencia_id;

-- 9) EMPLEADOS que condicionan la reconstruccion posterior (el reset NO los modifica ni los repara)
-- 9a) BLOQUEANTE: fecha_alta NULL / invalida / < 1980 (Elisa, id 37, 1899-12-31). NO se repara automaticamente: requiere el dato de RRHH.
SELECT e.empresa_id, e.id AS empleado_id, e.nombre, e.fecha_alta, e.fecha_inicio_laboral, e.estado,
       'BLOQUEANTE: fecha_alta invalida/sospechosa; requiere dato de RRHH antes de reconstruir' AS diagnostico
FROM empleados e WHERE e.fecha_alta IS NULL OR e.fecha_alta < '1980-01-01'
ORDER BY e.id;
-- 9b) INFORMATIVO: fecha_alta <> fecha_inicio_laboral (Amilcar, id 14: inicio laboral 13/02/2023 vs base de vacaciones 13/04/2023). NO se repara.
SELECT e.empresa_id, e.id AS empleado_id, e.nombre, e.fecha_alta, e.fecha_inicio_laboral,
       DATEDIFF(e.fecha_alta, e.fecha_inicio_laboral) AS dias_de_diferencia,
       'Diferencia entre fecha entrada laboral y base de vacaciones' AS diagnostico
FROM empleados e
WHERE e.fecha_alta IS NOT NULL AND e.fecha_inicio_laboral IS NOT NULL AND e.fecha_alta <> e.fecha_inicio_laboral
ORDER BY e.id;

-- 10) CONTEOS POR EMPRESA (aislamiento: el reset se ejecuta una empresa a la vez, siempre con empresa_id)
SELECT e.id AS empresa_id, e.nombre AS empresa,
       (SELECT COUNT(*) FROM vacaciones v WHERE v.empresa_id = e.id) AS vacaciones,
       (SELECT COUNT(*) FROM incidencias i WHERE i.empresa_id = e.id AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones')) AS incidencias_vacaciones,
       (SELECT COUNT(*) FROM incidencias i WHERE i.empresa_id = e.id AND i.tipo NOT IN ('Vacaciones','A cuenta de Vacaciones')) AS incidencias_otros_tipos,
       (SELECT COUNT(*) FROM detalle_consumo_vacaciones d JOIN incidencias i ON i.id = d.incidencia_id WHERE i.empresa_id = e.id) AS detalle_consumo,
       (SELECT COUNT(*) FROM saldos_vacaciones s WHERE s.empresa_id = e.id) AS saldos,
       (SELECT COUNT(*) FROM solicitudes_vacaciones sv WHERE sv.empresa_id = e.id) AS solicitudes,
       (SELECT COUNT(*) FROM empleados em WHERE em.empresa_id = e.id) AS empleados
FROM empresas e
ORDER BY e.id;

-- 11) RESUMEN DE BLOQUEOS: el reset solo puede considerarse si TODAS estas cifras estan en 0 (o decididas por escrito por RRHH)
SELECT 'vacaciones sin incidencia' AS bloqueo, COUNT(*) AS filas FROM vacaciones v
  WHERE NOT EXISTS (SELECT 1 FROM incidencias i WHERE i.empresa_id = v.empresa_id AND i.id_empleado = v.id_empleado AND i.fecha_inicio = v.fecha_inicio AND i.fecha_fin = v.fecha_fin AND i.dias_habiles = v.dias_habiles AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones'))
UNION ALL
SELECT 'incidencias de vacaciones sin vacacion', COUNT(*) FROM incidencias i
  WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
    AND NOT EXISTS (SELECT 1 FROM vacaciones v WHERE v.empresa_id = i.empresa_id AND v.id_empleado = i.id_empleado AND v.fecha_inicio = i.fecha_inicio AND v.fecha_fin = i.fecha_fin AND v.dias_habiles = i.dias_habiles)
UNION ALL
SELECT 'detalle FIFO sobre incidencias que no son de vacaciones', COUNT(*) FROM detalle_consumo_vacaciones d JOIN incidencias i ON i.id = d.incidencia_id WHERE i.tipo NOT IN ('Vacaciones','A cuenta de Vacaciones')
UNION ALL
SELECT 'evidencias en incidencias de vacaciones', COUNT(*) FROM evidencias_incidencias ev JOIN incidencias i ON i.id = ev.incidencia_id WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
UNION ALL
SELECT 'solicitudes pendientes o ligadas a incidencias', COUNT(*) FROM solicitudes_vacaciones WHERE estado = 'Pendiente' OR incidencia_id IS NOT NULL
UNION ALL
SELECT 'duplicados identicos en vacaciones (grupos)', COUNT(*) FROM (
  SELECT 1 FROM vacaciones GROUP BY empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles HAVING COUNT(*) > 1) d
UNION ALL
SELECT 'tipo ambiguo o cantidad de incidencias distinta (grupos)', COUNT(*) FROM (
  SELECT g.empresa_id FROM (
    SELECT empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles FROM vacaciones
    UNION
    SELECT empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles FROM incidencias WHERE tipo IN ('Vacaciones','A cuenta de Vacaciones')
  ) g
  WHERE (SELECT COUNT(*) FROM vacaciones v WHERE v.empresa_id = g.empresa_id AND v.id_empleado = g.id_empleado AND v.fecha_inicio = g.fecha_inicio AND v.fecha_fin = g.fecha_fin AND v.dias_habiles = g.dias_habiles)
     <> (SELECT COUNT(*) FROM incidencias i WHERE i.empresa_id = g.empresa_id AND i.id_empleado = g.id_empleado AND i.fecha_inicio = g.fecha_inicio AND i.fecha_fin = g.fecha_fin AND i.dias_habiles = g.dias_habiles AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones'))
     OR (SELECT COUNT(DISTINCT i.tipo) FROM incidencias i WHERE i.empresa_id = g.empresa_id AND i.id_empleado = g.id_empleado AND i.fecha_inicio = g.fecha_inicio AND i.fecha_fin = g.fecha_fin AND i.dias_habiles = g.dias_habiles AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones')) > 1
) t
UNION ALL
SELECT 'vacaciones con estado distinto de Aprobado', COUNT(*) FROM vacaciones WHERE LOWER(TRIM(estado)) <> 'aprobado'
UNION ALL
SELECT 'empleados con fecha_alta invalida (Elisa)', COUNT(*) FROM empleados WHERE fecha_alta IS NULL OR fecha_alta < '1980-01-01';

-- 12) CONJUNTO OBJETIVO DEL RESET vs TOTAL, por empresa (HARD BLOCKER: para un RESET COMPLETO deben ser iguales; si no, NO se borra nada)
--     Objetivo = incidencias de vacaciones con fila espejo INEQUIVOCA (1 incidencia <-> 1 vacacion aprobada para su llave), sin evidencias y sin
--     solicitud ligada. Es la misma definicion de tmp_reset_incidencias_objetivo en sql/propuesta-reset-vacaciones.sql. SOLO LECTURA.
--     Ademas debe coincidir con el numero de filas del export validado (completo = true).
SELECT e.id AS empresa_id,
       (SELECT COUNT(*) FROM incidencias i WHERE i.empresa_id = e.id AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones')) AS total_incidencias_vacaciones,
       (SELECT COUNT(*) FROM incidencias i
         WHERE i.empresa_id = e.id AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
           AND (SELECT COUNT(*) FROM vacaciones v WHERE v.empresa_id = i.empresa_id AND v.id_empleado = i.id_empleado AND v.fecha_inicio = i.fecha_inicio AND v.fecha_fin = i.fecha_fin AND v.dias_habiles = i.dias_habiles AND LOWER(TRIM(v.estado)) = 'aprobado') = 1
           AND (SELECT COUNT(*) FROM vacaciones v WHERE v.empresa_id = i.empresa_id AND v.id_empleado = i.id_empleado AND v.fecha_inicio = i.fecha_inicio AND v.fecha_fin = i.fecha_fin AND v.dias_habiles = i.dias_habiles) = 1
           AND (SELECT COUNT(*) FROM incidencias i2 WHERE i2.empresa_id = i.empresa_id AND i2.id_empleado = i.id_empleado AND i2.fecha_inicio = i.fecha_inicio AND i2.fecha_fin = i.fecha_fin AND i2.dias_habiles = i.dias_habiles AND i2.tipo IN ('Vacaciones','A cuenta de Vacaciones')) = 1
           AND NOT EXISTS (SELECT 1 FROM evidencias_incidencias ev WHERE ev.incidencia_id = i.id)
           AND NOT EXISTS (SELECT 1 FROM solicitudes_vacaciones sv WHERE sv.incidencia_id = i.id)) AS total_objetivo,
       (SELECT COUNT(*) FROM vacaciones v WHERE v.empresa_id = e.id) AS total_vacaciones
FROM empresas e
ORDER BY e.id;
--     Lectura: la empresa SOLO puede resetearse si total_incidencias_vacaciones = total_objetivo = total_vacaciones = filas del export validado.
--     Cualquier diferencia es un HARD BLOCKER: se corrige el dato (o RRHH decide caso por caso) y se repite el preflight; NO se borra nada.

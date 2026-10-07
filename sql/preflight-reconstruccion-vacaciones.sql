-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — RECONSTRUCCION COMPLETA DE VACACIONES DESDE EL HISTORIAL OFICIAL
-- No ejecutado por Claude. Solo SELECT: no modifica nada. MariaDB 11.8.
-- Ejecutar sentencia por sentencia en la base REAL ANTES de aplicar sql/reconstruccion-vacaciones-propuesta.sql (todo comentado)
-- y guardar los resultados como evidencia. Complementa a sql/preflight-2026-10-vacaciones-historial-periodos.sql.
--
-- Reglas que este preflight protege:
--   * NO se toca ninguna incidencia que no sea de tipo 'Vacaciones' / 'A cuenta de Vacaciones'.
--   * NO se usa TRUNCATE ni FOREIGN_KEY_CHECKS=0. Los borrados siempre llevan filtro y se verifican con conteos.
--   * NO se sobrescribe backup_saldos_vacaciones_20261006 ni ningun respaldo existente.
--   * detalle_consumo_vacaciones.saldo_id / incidencia_id son ON DELETE CASCADE: el orden de borrado importa.
-- =====================================================================

-- 0) Conteos actuales (referencia segun la inspeccion: vacaciones 31, incidencias de vacaciones 31, detalle 35, saldos 441, solicitudes 0)
SELECT 'vacaciones' AS tabla, COUNT(*) AS filas FROM vacaciones
UNION ALL SELECT 'incidencias tipo Vacaciones / A cuenta de Vacaciones', COUNT(*) FROM incidencias WHERE tipo IN ('Vacaciones','A cuenta de Vacaciones')
UNION ALL SELECT 'detalle_consumo_vacaciones', COUNT(*) FROM detalle_consumo_vacaciones
UNION ALL SELECT 'saldos_vacaciones', COUNT(*) FROM saldos_vacaciones
UNION ALL SELECT 'solicitudes_vacaciones', COUNT(*) FROM solicitudes_vacaciones;

-- 1) Respaldos existentes (NO deben sobrescribirse) y colision con los nombres que usara la propuesta
SELECT TABLE_NAME, TABLE_ROWS, CREATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'backup\_%' OR TABLE_NAME LIKE 'bk\_%')
ORDER BY TABLE_NAME;
-- Debe devolver backup_saldos_vacaciones_20261006 (intacto). Si ya existe alguna tabla bk_reconstruccion_<sello>_*, elegir otro sello.

-- 2) Incidencias por tipo — SOLO las de vacaciones son reconstruibles; las demas NO se tocan
SELECT tipo, COUNT(*) AS filas,
       CASE WHEN tipo IN ('Vacaciones','A cuenta de Vacaciones') THEN 'RECONSTRUIBLE' ELSE 'NO SE TOCA' END AS tratamiento
FROM incidencias GROUP BY tipo ORDER BY tratamiento, tipo;

-- 3) Todo lo que referencia a incidencias o a saldos_vacaciones (FK) — nada fuera de la lista esperada debe quedar huerfano
SELECT kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, kcu.REFERENCED_TABLE_NAME, rc.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
WHERE kcu.CONSTRAINT_SCHEMA = DATABASE() AND kcu.REFERENCED_TABLE_NAME IN ('incidencias', 'saldos_vacaciones', 'vacaciones')
ORDER BY kcu.REFERENCED_TABLE_NAME, kcu.TABLE_NAME;

-- 3b) Incidencias de vacaciones que NO se pueden borrar a la ligera: con evidencias adjuntas o ligadas a una solicitud
SELECT i.id AS incidencia_id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles,
       (SELECT COUNT(*) FROM evidencias_incidencias ev WHERE ev.incidencia_id = i.id) AS evidencias,
       (SELECT COUNT(*) FROM solicitudes_vacaciones sv WHERE sv.incidencia_id = i.id) AS solicitudes
FROM incidencias i
WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
HAVING evidencias > 0 OR solicitudes > 0
ORDER BY i.id;

-- 3c) Detalle FIFO que apunta a incidencias que NO son de vacaciones (esperado 0: si no, el borrado del detalle afectaria otro tipo)
SELECT d.id AS detalle_id, d.incidencia_id, i.tipo
FROM detalle_consumo_vacaciones d JOIN incidencias i ON i.id = d.incidencia_id
WHERE i.tipo NOT IN ('Vacaciones','A cuenta de Vacaciones');

-- 4) Pareja vacaciones <-> incidencias (esperado: 0 sin pareja en ambos sentidos)
SELECT 'VACACION_SIN_INCIDENCIA' AS problema, v.id, v.empresa_id, v.id_empleado, v.fecha_inicio, v.fecha_fin, v.dias_habiles
FROM vacaciones v
WHERE NOT EXISTS (SELECT 1 FROM incidencias i WHERE i.empresa_id = v.empresa_id AND i.id_empleado = v.id_empleado
                  AND i.fecha_inicio = v.fecha_inicio AND i.fecha_fin = v.fecha_fin AND i.dias_habiles = v.dias_habiles
                  AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones'))
UNION ALL
SELECT 'INCIDENCIA_SIN_VACACION', i.id, i.empresa_id, i.id_empleado, i.fecha_inicio, i.fecha_fin, i.dias_habiles
FROM incidencias i
WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
  AND NOT EXISTS (SELECT 1 FROM vacaciones v WHERE v.empresa_id = i.empresa_id AND v.id_empleado = i.id_empleado
                  AND v.fecha_inicio = i.fecha_inicio AND v.fecha_fin = i.fecha_fin AND v.dias_habiles = i.dias_habiles);

-- 5) EMPLEADOS BLOQUEANTES / A REVISAR antes de reconstruir
-- 5a) BLOQUEANTE: fecha de alta invalida o < 1980 (Elisa, id 37). NO se reconstruye hasta que RRHH corrija la ficha.
SELECT e.empresa_id, e.id AS empleado_id, e.nombre, e.fecha_alta, e.fecha_inicio_laboral, e.estado,
       'BLOQUEANTE: fecha_alta invalida/sospechosa; requiere dato de RRHH antes de reconstruir' AS diagnostico
FROM empleados e WHERE e.fecha_alta IS NULL OR e.fecha_alta < '1980-01-01'
ORDER BY e.id;
-- 5b) INFORMATIVO: fecha_alta <> fecha_inicio_laboral (Amilcar, id 14: inicio laboral 13/02/2023 vs base de vacaciones 13/04/2023).
--     Se reconstruye segun fecha_alta (regla vigente); se informa la diferencia.
SELECT e.empresa_id, e.id AS empleado_id, e.nombre, e.fecha_alta, e.fecha_inicio_laboral,
       DATEDIFF(e.fecha_alta, e.fecha_inicio_laboral) AS dias_de_diferencia,
       'Diferencia entre fecha entrada laboral y base de vacaciones' AS diagnostico
FROM empleados e
WHERE e.fecha_alta IS NOT NULL AND e.fecha_inicio_laboral IS NOT NULL AND e.fecha_alta <> e.fecha_inicio_laboral
ORDER BY e.id;

-- 6) Impacto por empleado: que se reemplazaria (vacaciones, incidencias, detalle y saldos actuales)
SELECT e.empresa_id, e.id AS empleado_id, e.nombre, e.fecha_alta,
       (SELECT COUNT(*) FROM vacaciones v WHERE v.empresa_id = e.empresa_id AND v.id_empleado = e.id) AS vacaciones_actuales,
       (SELECT COALESCE(SUM(v.dias_habiles), 0) FROM vacaciones v WHERE v.empresa_id = e.empresa_id AND v.id_empleado = e.id) AS dias_actuales,
       (SELECT COUNT(*) FROM incidencias i WHERE i.empresa_id = e.empresa_id AND i.id_empleado = e.id AND i.tipo IN ('Vacaciones','A cuenta de Vacaciones')) AS incidencias_vacaciones,
       (SELECT COUNT(*) FROM saldos_vacaciones s WHERE s.empresa_id = e.empresa_id AND s.id_empleado = e.id) AS saldos,
       (SELECT COUNT(*) FROM detalle_consumo_vacaciones d JOIN saldos_vacaciones s ON s.id = d.saldo_id WHERE s.empresa_id = e.empresa_id AND s.id_empleado = e.id) AS lineas_detalle,
       (SELECT COALESCE(SUM(s.dias_disponibles), 0) FROM saldos_vacaciones s WHERE s.empresa_id = e.empresa_id AND s.id_empleado = e.id AND s.estado = 'Vigente') AS saldo_actual
FROM empleados e
WHERE EXISTS (SELECT 1 FROM saldos_vacaciones s WHERE s.empresa_id = e.empresa_id AND s.id_empleado = e.id)
   OR EXISTS (SELECT 1 FROM vacaciones v WHERE v.empresa_id = e.empresa_id AND v.id_empleado = e.id)
ORDER BY e.empresa_id, e.id;

-- 7) VALIDACION DEL STAGING (ejecutar SOLO despues de cargar el archivo validado en las tablas de staging; hoy NO existen).
--    Descomentar entonces. Tablas: stg_vac_historial (filas oficiales), ver sql/reconstruccion-vacaciones-propuesta.sql, paso 2.
-- SELECT COUNT(*) AS filas_staging, COUNT(DISTINCT empleado_id) AS empleados FROM stg_vac_historial;
-- -- duplicados por llave logica (empleado, inicio, fin, dias, tipo): esperado 0
-- SELECT empleado_id, fecha_inicio, fecha_fin, dias_habiles, tipo, COUNT(*) AS veces FROM stg_vac_historial
--  GROUP BY empleado_id, fecha_inicio, fecha_fin, dias_habiles, tipo HAVING COUNT(*) > 1;
-- -- empleados de staging que no existen en la empresa: esperado 0
-- SELECT s.empleado_id FROM stg_vac_historial s LEFT JOIN empleados e ON e.id = s.empleado_id AND e.empresa_id = s.empresa_id WHERE e.id IS NULL GROUP BY s.empleado_id;
-- -- empleados BLOQUEANTES dentro del staging (fecha_alta invalida): esperado 0
-- SELECT e.id, e.nombre, e.fecha_alta FROM empleados e WHERE e.id IN (SELECT empleado_id FROM stg_vac_historial) AND (e.fecha_alta IS NULL OR e.fecha_alta < '1980-01-01');
-- -- empleados con vacaciones ACTUALES que el staging no trae (se reemplazarian por nada): decidir con RRHH
-- SELECT v.id_empleado, COUNT(*) AS vacaciones_actuales FROM vacaciones v WHERE v.id_empleado NOT IN (SELECT empleado_id FROM stg_vac_historial) GROUP BY v.id_empleado;

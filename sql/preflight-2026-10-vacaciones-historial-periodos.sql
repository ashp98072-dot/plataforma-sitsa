-- =====================================================================
-- PREFLIGHT (SOLO LECTURA) — RRHH VACACIONES: HISTORIAL COMPLETO + REPARACION DE PERIODOS
-- No ejecutado por Claude. Solo SELECT: no modifica nada. MariaDB 11.8 (usa funciones de ventana).
-- Ejecutar sentencia por sentencia en la base REAL y guardar los resultados para decidir la reparacion
-- (sql/propuesta-2026-10-reparar-periodos-vacaciones.sql, TODO comentado).
--
-- Reglas de referencia (las mismas del motor corregido, src/lib/rrhh/vacaciones-periodos.ts):
--   periodo n = [ fecha_alta + (n-1) anios , fecha_alta + n anios - 1 dia ]   (inclusivo en ambos extremos)
--   un periodo siguiente empieza EXACTAMENTE el dia despues de que termina el anterior.
--   dias de superposicion = DATEDIFF(LEAST(fin_a, fin_b), GREATEST(inicio_a, inicio_b)) + 1
--   BORDE = se tocan solo por compartir la fecha limite (1 dia: fin de uno = inicio del otro) · REAL = mas de 1 dia.
-- IMPORTANTE: detalle_consumo_vacaciones.saldo_id tiene ON DELETE CASCADE -> borrar un saldo con consumo BORRARIA su detalle FIFO.
-- =====================================================================

-- 0) Conteos globales (esperado segun la inspeccion: vacaciones 31, incidencias de vacaciones 31, solicitudes 0, detalle 35, saldos 441)
SELECT 'vacaciones' AS tabla, COUNT(*) AS filas FROM vacaciones
UNION ALL SELECT 'incidencias (Vacaciones / A cuenta de Vacaciones)', COUNT(*) FROM incidencias WHERE tipo IN ('Vacaciones','A cuenta de Vacaciones')
UNION ALL SELECT 'solicitudes_vacaciones', COUNT(*) FROM solicitudes_vacaciones
UNION ALL SELECT 'detalle_consumo_vacaciones', COUNT(*) FROM detalle_consumo_vacaciones
UNION ALL SELECT 'saldos_vacaciones', COUNT(*) FROM saldos_vacaciones;

-- 1) Por empleado: fecha laboral actual, numero de periodos, primer/ultimo periodo, totales
SELECT e.empresa_id, e.id AS empleado_id, e.nombre,
       e.fecha_alta, e.fecha_inicio_laboral,
       COUNT(s.id) AS periodos,
       SUM(s.estado = 'Vigente') AS vigentes, SUM(s.estado = 'Vencido') AS vencidos,
       MIN(s.periodo_inicio) AS primer_periodo_inicio, MAX(s.periodo_fin) AS ultimo_periodo_fin,
       SUM(s.dias_otorgados) AS total_otorgado, SUM(s.dias_disponibles) AS total_disponible,
       TIMESTAMPDIFF(YEAR, e.fecha_alta, CURDATE()) + 1 AS periodos_esperados_max
FROM empleados e
LEFT JOIN saldos_vacaciones s ON s.empresa_id = e.empresa_id AND s.id_empleado = e.id
GROUP BY e.empresa_id, e.id, e.nombre, e.fecha_alta, e.fecha_inicio_laboral
HAVING COUNT(s.id) > 0
ORDER BY periodos DESC, e.empresa_id, e.id;

-- 2) FECHA LABORAL SOSPECHOSA (< 1980 o NULL con saldos) — SOLO REPORTE, no se corrige nada aqui
SELECT e.empresa_id, e.id AS empleado_id, e.nombre, e.fecha_alta, e.fecha_inicio_laboral, e.estado,
       COUNT(s.id) AS periodos, MIN(s.periodo_inicio) AS primer_periodo, MAX(s.periodo_fin) AS ultimo_periodo,
       SUM(s.dias_otorgados) AS total_otorgado, SUM(s.dias_disponibles) AS total_disponible,
       'fecha laboral invalida/sospechosa; requiere dato de RRHH antes de reparar' AS accion
FROM empleados e
JOIN saldos_vacaciones s ON s.empresa_id = e.empresa_id AND s.id_empleado = e.id
WHERE e.fecha_alta IS NULL OR e.fecha_alta < '1980-01-01'
GROUP BY e.empresa_id, e.id, e.nombre, e.fecha_alta, e.fecha_inicio_laboral, e.estado
ORDER BY periodos DESC;

-- 2b) Periodos anteriores a fechas razonables: antes de 1980 o antes de la propia fecha de alta del empleado
SELECT s.id AS saldo_id, s.empresa_id, s.id_empleado, e.nombre, e.fecha_alta, s.anio_laboral, s.periodo_inicio, s.periodo_fin,
       CASE WHEN s.periodo_inicio < '1980-01-01' THEN 'ANTERIOR_A_1980'
            WHEN s.periodo_inicio < e.fecha_alta THEN 'ANTERIOR_A_FECHA_ALTA' END AS motivo
FROM saldos_vacaciones s
JOIN empleados e ON e.id = s.id_empleado AND e.empresa_id = s.empresa_id
WHERE s.periodo_inicio < '1980-01-01' OR s.periodo_inicio < e.fecha_alta
ORDER BY s.id_empleado, s.periodo_inicio;

-- 3) PERIODOS TRASLAPADOS (pares del mismo empleado) con dias de superposicion y tipo BORDE / REAL
SELECT a.empresa_id, a.id_empleado, e.nombre,
       a.id AS saldo_a, a.anio_laboral AS anio_a, a.periodo_inicio AS inicio_a, a.periodo_fin AS fin_a, a.estado AS estado_a,
       b.id AS saldo_b, b.anio_laboral AS anio_b, b.periodo_inicio AS inicio_b, b.periodo_fin AS fin_b, b.estado AS estado_b,
       DATEDIFF(LEAST(a.periodo_fin, b.periodo_fin), GREATEST(a.periodo_inicio, b.periodo_inicio)) + 1 AS dias_superposicion,
       CASE WHEN DATEDIFF(LEAST(a.periodo_fin, b.periodo_fin), GREATEST(a.periodo_inicio, b.periodo_inicio)) + 1 = 1
                 AND (a.periodo_fin = b.periodo_inicio OR b.periodo_fin = a.periodo_inicio) THEN 'BORDE (solo fecha limite)'
            ELSE 'REAL (varios dias)' END AS tipo,
       EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = a.id) AS a_con_consumo,
       EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = b.id) AS b_con_consumo
FROM saldos_vacaciones a
JOIN saldos_vacaciones b ON b.empresa_id = a.empresa_id AND b.id_empleado = a.id_empleado AND b.id > a.id
JOIN empleados e ON e.id = a.id_empleado AND e.empresa_id = a.empresa_id
WHERE a.periodo_inicio <= b.periodo_fin AND b.periodo_inicio <= a.periodo_fin
ORDER BY tipo, dias_superposicion DESC, a.id_empleado, a.periodo_inicio;

-- 3b) Resumen de traslapes por tipo
SELECT tipo, COUNT(*) AS pares, MAX(dias_superposicion) AS max_dias
FROM (
  SELECT CASE WHEN DATEDIFF(LEAST(a.periodo_fin, b.periodo_fin), GREATEST(a.periodo_inicio, b.periodo_inicio)) + 1 = 1
                   AND (a.periodo_fin = b.periodo_inicio OR b.periodo_fin = a.periodo_inicio) THEN 'BORDE' ELSE 'REAL' END AS tipo,
         DATEDIFF(LEAST(a.periodo_fin, b.periodo_fin), GREATEST(a.periodo_inicio, b.periodo_inicio)) + 1 AS dias_superposicion
  FROM saldos_vacaciones a
  JOIN saldos_vacaciones b ON b.empresa_id = a.empresa_id AND b.id_empleado = a.id_empleado AND b.id > a.id
  WHERE a.periodo_inicio <= b.periodo_fin AND b.periodo_inicio <= a.periodo_fin
) t GROUP BY tipo;

-- 4) DUPLICADOS: mismo empleado y mismo anio_laboral; mismo inicio; anio_laboral NULO
SELECT 'ANIO_LABORAL_REPETIDO' AS problema, empresa_id, id_empleado, anio_laboral AS valor, COUNT(*) AS filas, GROUP_CONCAT(id ORDER BY id) AS saldos
FROM saldos_vacaciones WHERE anio_laboral IS NOT NULL GROUP BY empresa_id, id_empleado, anio_laboral HAVING COUNT(*) > 1
UNION ALL
SELECT 'INICIO_REPETIDO', empresa_id, id_empleado, periodo_inicio, COUNT(*), GROUP_CONCAT(id ORDER BY id)
FROM saldos_vacaciones GROUP BY empresa_id, id_empleado, periodo_inicio HAVING COUNT(*) > 1
UNION ALL
SELECT 'ANIO_LABORAL_NULO', empresa_id, id_empleado, NULL, COUNT(*), GROUP_CONCAT(id ORDER BY id)
FROM saldos_vacaciones WHERE anio_laboral IS NULL GROUP BY empresa_id, id_empleado;

-- 5) GAPS entre periodos consecutivos (dias sin cubrir entre el fin de uno y el inicio del siguiente)
SELECT empresa_id, id_empleado, saldo_id, periodo_fin AS fin_anterior, siguiente_inicio, DATEDIFF(siguiente_inicio, periodo_fin) - 1 AS dias_gap
FROM (
  SELECT empresa_id, id_empleado, id AS saldo_id, periodo_fin,
         LEAD(periodo_inicio) OVER (PARTITION BY empresa_id, id_empleado ORDER BY periodo_inicio, id) AS siguiente_inicio
  FROM saldos_vacaciones
) t
WHERE siguiente_inicio IS NOT NULL AND DATEDIFF(siguiente_inicio, periodo_fin) - 1 > 0
ORDER BY dias_gap DESC, id_empleado;

-- 6) Valores inconsistentes: otorgados > 15, disponibles > otorgados, negativos
SELECT s.id AS saldo_id, s.empresa_id, s.id_empleado, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.dias_otorgados, s.dias_disponibles, s.estado,
       CASE WHEN s.dias_otorgados > 15 THEN 'OTORGADOS_MAYOR_15'
            WHEN s.dias_disponibles > s.dias_otorgados THEN 'DISPONIBLES_MAYOR_OTORGADOS'
            WHEN s.dias_disponibles < 0 OR s.dias_otorgados < 0 THEN 'NEGATIVO' END AS problema
FROM saldos_vacaciones s
WHERE s.dias_otorgados > 15 OR s.dias_disponibles > s.dias_otorgados OR s.dias_disponibles < 0 OR s.dias_otorgados < 0;

-- 7) CONSUMOS (detalle FIFO)
-- 7a) detalle que apunta a un saldo inexistente (esperado 0: la FK lo impide)
SELECT d.id AS detalle_id, d.incidencia_id, d.saldo_id, d.dias_tomados
FROM detalle_consumo_vacaciones d LEFT JOIN saldos_vacaciones s ON s.id = d.saldo_id WHERE s.id IS NULL;
-- 7b) detalle cuya incidencia pertenece a OTRO empleado (o empresa) distinto del dueno del saldo (esperado 0)
SELECT d.id AS detalle_id, d.incidencia_id, d.saldo_id, i.id_empleado AS empleado_incidencia, s.id_empleado AS empleado_saldo,
       i.empresa_id AS empresa_incidencia, s.empresa_id AS empresa_saldo
FROM detalle_consumo_vacaciones d
JOIN incidencias i ON i.id = d.incidencia_id
JOIN saldos_vacaciones s ON s.id = d.saldo_id
WHERE i.id_empleado <> s.id_empleado OR i.empresa_id <> s.empresa_id;
-- 7c) incidencias de vacaciones cuyo detalle no suma sus dias_habiles (el detalle de 2 saldos por incidencia es NORMAL: ej. incidencia 24 = 9 + 1)
SELECT i.id AS incidencia_id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles,
       COUNT(d.id) AS lineas_detalle, COALESCE(SUM(d.dias_tomados), 0) AS dias_detalle
FROM incidencias i LEFT JOIN detalle_consumo_vacaciones d ON d.incidencia_id = i.id
WHERE i.tipo IN ('Vacaciones','A cuenta de Vacaciones')
GROUP BY i.id, i.id_empleado, i.tipo, i.fecha_inicio, i.fecha_fin, i.dias_habiles
HAVING COALESCE(SUM(d.dias_tomados), 0) <> i.dias_habiles
ORDER BY i.id;
-- 7d) vacaciones sin incidencia pareja y incidencias sin vacaciones pareja (empresa + empleado + fechas + dias) (esperado 0 / 0)
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

-- 8) Saldos USADOS por el detalle FIFO y cuales NO pueden eliminarse (tienen consumo)
SELECT s.id AS saldo_id, s.empresa_id, s.id_empleado, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.estado,
       COUNT(d.id) AS lineas_detalle, SUM(d.dias_tomados) AS dias_consumidos, GROUP_CONCAT(d.incidencia_id ORDER BY d.incidencia_id) AS incidencias,
       'NO ELIMINAR (tiene consumo FIFO; el DELETE en cascada borraria el detalle)' AS nota
FROM saldos_vacaciones s JOIN detalle_consumo_vacaciones d ON d.saldo_id = s.id
GROUP BY s.id, s.empresa_id, s.id_empleado, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.estado
ORDER BY s.id_empleado, s.periodo_inicio;

-- 9) CLASIFICACION de cada saldo (A/B/C/D) — insumo de la propuesta de reparacion; NO modifica nada
--   D = la ficha del empleado requiere correccion previa (fecha laboral invalida/sospechosa)
--   B = tiene consumo FIFO: NO eliminar ni renumerar sin una migracion explicita
--   A = SEGURO de eliminar: sin consumo, fecha laboral plausible y el periodo queda fuera de la vida laboral
--       (empieza antes de la fecha de alta o su anio laboral es mayor que el maximo esperado)
--   C = requiere decision de RRHH: sin consumo pero participa en traslape/duplicado o no coincide con lo esperado
SELECT clase, COUNT(*) AS saldos FROM (
  SELECT CASE
           WHEN e.fecha_alta IS NULL OR e.fecha_alta < '1980-01-01' THEN 'D - corregir ficha del empleado primero'
           WHEN EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id) THEN 'B - con consumo: NO eliminar'
           WHEN s.periodo_inicio < e.fecha_alta OR s.anio_laboral > TIMESTAMPDIFF(YEAR, e.fecha_alta, CURDATE()) + 1 THEN 'A - seguro de eliminar (fuera de la vida laboral)'
           WHEN EXISTS (SELECT 1 FROM saldos_vacaciones o WHERE o.empresa_id = s.empresa_id AND o.id_empleado = s.id_empleado AND o.id <> s.id
                        AND o.periodo_inicio <= s.periodo_fin AND s.periodo_inicio <= o.periodo_fin)
                OR s.anio_laboral IS NULL THEN 'C - decision de RRHH (traslape/anio laboral nulo)'
           WHEN s.periodo_inicio <> DATE_ADD(e.fecha_alta, INTERVAL (s.anio_laboral - 1) YEAR)
                OR s.periodo_fin <> DATE_SUB(DATE_ADD(e.fecha_alta, INTERVAL s.anio_laboral YEAR), INTERVAL 1 DAY) THEN 'C - decision de RRHH (fechas distintas a lo esperado)'
           ELSE 'OK - coincide con la fecha laboral'
         END AS clase
  FROM saldos_vacaciones s JOIN empleados e ON e.id = s.id_empleado AND e.empresa_id = s.empresa_id
) t GROUP BY clase ORDER BY clase;

-- 9b) Detalle por saldo de las clases A y C (y D/B si se quiere revisar): mismo CASE
SELECT s.id AS saldo_id, s.empresa_id, s.id_empleado, e.nombre, e.fecha_alta, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.dias_otorgados, s.dias_disponibles, s.estado,
       CASE
         WHEN e.fecha_alta IS NULL OR e.fecha_alta < '1980-01-01' THEN 'D'
         WHEN EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id) THEN 'B'
         WHEN s.periodo_inicio < e.fecha_alta OR s.anio_laboral > TIMESTAMPDIFF(YEAR, e.fecha_alta, CURDATE()) + 1 THEN 'A'
         WHEN EXISTS (SELECT 1 FROM saldos_vacaciones o WHERE o.empresa_id = s.empresa_id AND o.id_empleado = s.id_empleado AND o.id <> s.id
                      AND o.periodo_inicio <= s.periodo_fin AND s.periodo_inicio <= o.periodo_fin) OR s.anio_laboral IS NULL THEN 'C'
         WHEN s.periodo_inicio <> DATE_ADD(e.fecha_alta, INTERVAL (s.anio_laboral - 1) YEAR)
              OR s.periodo_fin <> DATE_SUB(DATE_ADD(e.fecha_alta, INTERVAL s.anio_laboral YEAR), INTERVAL 1 DAY) THEN 'C'
         ELSE 'OK' END AS clase
FROM saldos_vacaciones s JOIN empleados e ON e.id = s.id_empleado AND e.empresa_id = s.empresa_id
HAVING clase IN ('A','C')
ORDER BY clase, s.id_empleado, s.periodo_inicio;

-- 10) ELISA — empleado id = 37 (Elisa Jimenez Lopez). NO se asume su fecha correcta.
SELECT e.id AS empleado_id, e.empresa_id, e.nombre, e.estado, e.fecha_alta, e.fecha_inicio_laboral,
       COUNT(s.id) AS periodos, MIN(s.periodo_inicio) AS primer_periodo, MAX(s.periodo_fin) AS ultimo_periodo,
       SUM(s.dias_otorgados) AS total_otorgado, SUM(s.dias_disponibles) AS total_disponible,
       SUM(s.periodo_inicio < '2010-01-01') AS periodos_anteriores_a_2010,
       SUM(EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id)) AS periodos_con_consumo,
       'fecha laboral invalida/sospechosa; requiere dato de RRHH antes de reparar' AS diagnostico
FROM empleados e LEFT JOIN saldos_vacaciones s ON s.empresa_id = e.empresa_id AND s.id_empleado = e.id
WHERE e.id = 37
GROUP BY e.id, e.empresa_id, e.nombre, e.estado, e.fecha_alta, e.fecha_inicio_laboral;
-- 10b) Periodos de Elisa que SI tienen consumo o estan Vigentes (los unicos que no se tocan sin decision)
SELECT s.id AS saldo_id, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.dias_otorgados, s.dias_disponibles, s.estado,
       COALESCE((SELECT SUM(d.dias_tomados) FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id), 0) AS dias_consumidos
FROM saldos_vacaciones s WHERE s.id_empleado = 37 AND (s.estado = 'Vigente' OR EXISTS (SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id))
ORDER BY s.periodo_inicio;

-- 11) Referencia: ejemplos citados en la inspeccion (Amilcar Bernabe Torres Cho: saldos 78 y 79; incidencia 24: saldos 69 y 70)
SELECT s.id AS saldo_id, s.id_empleado, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.dias_otorgados, s.dias_disponibles, s.estado
FROM saldos_vacaciones s WHERE s.id IN (69, 70, 78, 79) ORDER BY s.id;
SELECT d.id, d.incidencia_id, d.saldo_id, d.dias_tomados FROM detalle_consumo_vacaciones d WHERE d.incidencia_id = 24 ORDER BY d.id;

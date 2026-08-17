-- =====================================================================
-- Corrección de saldos de vacaciones afectados por el bug del tope FIFO
-- prematuro (se descontaba del periodo 1 apenas el periodo 2 empezaba
-- a acumular, sin haber 2 periodos completos todavía).
--
-- IMPORTANTE: corre esto DESPUÉS de subir el fix en vacaciones.ts.
-- Si lo corres antes, el próximo clic en la pantalla de Vacaciones de
-- ese empleado (con el código viejo) va a volver a descontarlo.
--
-- Paso 1: SOLO LECTURA. Corre esto primero y revisa los resultados.
-- =====================================================================
SELECT
  s.id AS saldo_id,
  s.empresa_id,
  s.id_empleado,
  e.nombre,
  s.anio_laboral,
  s.periodo_inicio,
  s.periodo_fin,
  s.dias_otorgados,
  s.dias_disponibles,
  (s.dias_otorgados - s.dias_disponibles) AS descontado_de_mas
FROM saldos_vacaciones s
JOIN empleados e ON e.id = s.id_empleado AND e.empresa_id = s.empresa_id
WHERE s.estado = 'Vigente'
  AND s.dias_disponibles < s.dias_otorgados
  -- este periodo no es el más reciente (es decir, no es el "en curso")
  AND s.anio_laboral < (
        SELECT MAX(s2.anio_laboral) FROM saldos_vacaciones s2
        WHERE s2.empresa_id = s.empresa_id AND s2.id_empleado = s.id_empleado
      )
  -- y la persona tiene MENOS de 2 periodos completos vigentes
  -- (si tuviera 2 o más, el descuento sí puede ser legítimo)
  AND (
        SELECT COUNT(*) FROM saldos_vacaciones s3
        WHERE s3.empresa_id = s.empresa_id AND s3.id_empleado = s.id_empleado
          AND s3.estado = 'Vigente'
          AND s3.anio_laboral < (
                SELECT MAX(s4.anio_laboral) FROM saldos_vacaciones s4
                WHERE s4.empresa_id = s.empresa_id AND s4.id_empleado = s.id_empleado
              )
      ) < 2
  -- y nunca se registró un consumo real contra este saldo
  AND NOT EXISTS (
        SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id
      )
ORDER BY e.nombre;

-- =====================================================================
-- Paso 2: si el listado de arriba se ve correcto (son los casos
-- afectados, sin consumo real), corre este UPDATE para reponer los
-- días descontados por error. Es idempotente: si lo corres dos veces
-- no pasa nada raro, la segunda vez no encuentra filas para tocar.
-- =====================================================================
UPDATE saldos_vacaciones s
JOIN (
  SELECT s.id AS saldo_id
  FROM saldos_vacaciones s
  WHERE s.estado = 'Vigente'
    AND s.dias_disponibles < s.dias_otorgados
    AND s.anio_laboral < (
          SELECT MAX(s2.anio_laboral) FROM saldos_vacaciones s2
          WHERE s2.empresa_id = s.empresa_id AND s2.id_empleado = s.id_empleado
        )
    AND (
          SELECT COUNT(*) FROM saldos_vacaciones s3
          WHERE s3.empresa_id = s.empresa_id AND s3.id_empleado = s.id_empleado
            AND s3.estado = 'Vigente'
            AND s3.anio_laboral < (
                  SELECT MAX(s4.anio_laboral) FROM saldos_vacaciones s4
                  WHERE s4.empresa_id = s.empresa_id AND s4.id_empleado = s.id_empleado
                )
        ) < 2
    AND NOT EXISTS (
          SELECT 1 FROM detalle_consumo_vacaciones d WHERE d.saldo_id = s.id
        )
) t ON t.saldo_id = s.id
SET s.dias_disponibles = s.dias_otorgados;
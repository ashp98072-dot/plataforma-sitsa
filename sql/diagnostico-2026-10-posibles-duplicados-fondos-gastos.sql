-- =====================================================================
-- DIAGNÓSTICO (SOLO LECTURA) — POSIBLES duplicados por doble envío: Solicitudes de Fondo y Gastos operativos
-- Archivo: sql/diagnostico-2026-10-posibles-duplicados-fondos-gastos.sql
--
-- SOLO SELECT (y SET de variables de sesión). NO borra, corrige ni modifica nada. Es una herramienta de REVISIÓN: un grupo
-- aquí es un CANDIDATO, no una conclusión; dos registros legítimos iguales pueden existir (por eso no hay UNIQUE por
-- contenido). La decisión sobre cada grupo es del negocio.
--
-- CRITERIO (conjunto, nunca monto o total por sí solos): misma empresa + mismo solicitante/requirente + misma fecha +
-- mismo concepto/categoría + misma descripción + mismo monto + mismas observaciones + MISMO DETALLE (líneas, en orden),
-- creados con pocos segundos/minutos de diferencia. Ajustar las variables de abajo.
--
-- ESQUEMA EXPLÍCITO: tablas calificadas `u611730801_Plataforma.<tabla>`. Sin ROW_COUNT()/DATABASE().
-- =====================================================================

SET SESSION group_concat_max_len = 1000000;

-- ---- PARÁMETROS (editar) ---------------------------------------------------------------------------------
SET @empresa_id := 1;                         -- obligatorio: una empresa a la vez (aislamiento por empresa)
SET @desde      := '2026-01-01 00:00:00';     -- ventana de creación a revisar
SET @hasta      := '2027-01-01 00:00:00';
SET @ventana_s  := 600;                       -- máximo de segundos entre el primero y el último registro del grupo
-- ----------------------------------------------------------------------------------------------------------

-- A) SOLICITUDES DE FONDO — grupos candidatos (cabecera idéntica + detalle idéntico + creadas dentro de la ventana).
SELECT s.empresa_id, s.requirente_usuario_id, s.solicitante_usuario_id, s.fecha_requerimiento, s.total,
       IFNULL(s.observaciones, '') AS observaciones,
       COUNT(*) AS registros,
       GROUP_CONCAT(s.id ORDER BY s.id) AS ids,
       GROUP_CONCAT(s.codigo ORDER BY s.id) AS codigos,
       GROUP_CONCAT(s.estado ORDER BY s.id) AS estados,
       MIN(s.creado_en) AS primera_creacion, MAX(s.creado_en) AS ultima_creacion,
       TIMESTAMPDIFF(SECOND, MIN(s.creado_en), MAX(s.creado_en)) AS segundos_entre_extremos
FROM (
  SELECT h.*, (SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', l.orden, l.categoria, IFNULL(l.descripcion, ''), l.cantidad, l.monto,
                                                  IFNULL(l.fecha_viaje, ''), IFNULL(l.empleado_id, ''), IFNULL(l.cuenta, ''),
                                                  IFNULL(l.metodo_pago, ''), IFNULL(l.vehiculo_id, ''), IFNULL(l.cliente_id, ''),
                                                  IFNULL(l.plan_id, '')) ORDER BY l.orden, l.id SEPARATOR ';;'))
               FROM u611730801_Plataforma.tms_solicitud_fondo_lineas l
               WHERE l.empresa_id = h.empresa_id AND l.solicitud_id = h.id) AS firma_lineas
  FROM u611730801_Plataforma.tms_solicitudes_fondo h
  WHERE h.empresa_id = @empresa_id AND h.creado_en >= @desde AND h.creado_en < @hasta
) s
GROUP BY s.empresa_id, s.requirente_usuario_id, s.solicitante_usuario_id, s.fecha_requerimiento, s.total,
         IFNULL(s.observaciones, ''), s.firma_lineas
HAVING COUNT(*) > 1 AND TIMESTAMPDIFF(SECOND, MIN(s.creado_en), MAX(s.creado_en)) <= @ventana_s
ORDER BY MIN(s.creado_en) DESC;

-- B) GASTOS OPERATIVOS — grupos candidatos (cabecera idéntica + detalle idéntico + creados dentro de la ventana).
--    Incluye concepto/categoría, descripción, plan/viaje, cuenta de pago, observaciones y las líneas.
SELECT g.empresa_id, g.solicitante_usuario_id, g.requirente_usuario_id, g.fecha_solicitud, g.categoria,
       IFNULL(g.descripcion, '') AS descripcion, g.cantidad, g.monto, g.plan_id,
       IFNULL(g.numero_cuenta_pago, '') AS numero_cuenta_pago, IFNULL(g.observaciones, '') AS observaciones,
       COUNT(*) AS registros,
       GROUP_CONCAT(g.id ORDER BY g.id) AS ids,
       GROUP_CONCAT(g.codigo ORDER BY g.id) AS codigos,
       GROUP_CONCAT(IFNULL(g.estado, 'histórico') ORDER BY g.id) AS estados,
       MIN(g.creado_en) AS primera_creacion, MAX(g.creado_en) AS ultima_creacion,
       TIMESTAMPDIFF(SECOND, MIN(g.creado_en), MAX(g.creado_en)) AS segundos_entre_extremos
FROM (
  SELECT h.*, (SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', l.orden, l.categoria, IFNULL(l.descripcion, ''), l.cantidad, l.monto,
                                                  IFNULL(l.metodo_pago, ''), IFNULL(l.numero_cuenta_pago, ''), IFNULL(l.fecha_viaje, ''),
                                                  IFNULL(l.empleado_id, ''), IFNULL(l.vehiculo_id, ''), IFNULL(l.cliente_id, ''),
                                                  IFNULL(l.plan_id, '')) ORDER BY l.orden, l.id SEPARATOR ';;'))
               FROM u611730801_Plataforma.tms_gasto_operativo_lineas l
               WHERE l.empresa_id = h.empresa_id AND l.gasto_id = h.id) AS firma_lineas
  FROM u611730801_Plataforma.tms_gastos_operativos h
  WHERE h.empresa_id = @empresa_id AND h.creado_en >= @desde AND h.creado_en < @hasta
) g
GROUP BY g.empresa_id, g.solicitante_usuario_id, g.requirente_usuario_id, g.fecha_solicitud, g.categoria,
         IFNULL(g.descripcion, ''), g.cantidad, g.monto, g.plan_id, IFNULL(g.numero_cuenta_pago, ''),
         IFNULL(g.observaciones, ''), g.firma_lineas
HAVING COUNT(*) > 1 AND TIMESTAMPDIFF(SECOND, MIN(g.creado_en), MAX(g.creado_en)) <= @ventana_s
ORDER BY MIN(g.creado_en) DESC;

-- C) Después de aplicar la migración de idempotencia: cuántos registros ya llevan clave (cobertura de la protección).
--    (Falla con "Unknown column" si la migración todavía no se aplicó: es esperado.)
SELECT 'tms_solicitudes_fondo' AS tabla, COUNT(*) AS filas, SUM(clave_idempotencia IS NOT NULL) AS con_clave
FROM u611730801_Plataforma.tms_solicitudes_fondo WHERE empresa_id = @empresa_id
UNION ALL
SELECT 'tms_gastos_operativos', COUNT(*), SUM(clave_idempotencia IS NOT NULL)
FROM u611730801_Plataforma.tms_gastos_operativos WHERE empresa_id = @empresa_id;

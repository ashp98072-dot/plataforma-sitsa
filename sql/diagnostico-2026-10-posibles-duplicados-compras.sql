-- =====================================================================
-- DIAGNÓSTICO (SOLO LECTURA) — POSIBLES duplicados por doble envío: Requerimientos de Compras
-- Archivo: sql/diagnostico-2026-10-posibles-duplicados-compras.sql
--
-- SOLO SELECT (y SET de variables de sesión). NO borra, corrige ni modifica nada. Un grupo aquí es un CANDIDATO, no una
-- conclusión: dos requerimientos legítimos iguales pueden existir (por eso no hay UNIQUE por contenido). La decisión sobre
-- cada grupo es del negocio.
--
-- CRITERIO (conjunto, nunca total o proveedor por sí solos): misma empresa + mismo solicitante/requirente/encargado + misma
-- fecha + misma empresa requirente + mismas observaciones + MISMO DETALLE (proveedor, repuesto, cantidad de líneas, factura,
-- método y condición de pago, totales, en orden), creados con pocos segundos/minutos de diferencia.
-- Nota: los requerimientos con número de factura no pueden duplicarse (UNIQUE de facturas por proveedor); este diagnóstico
-- cubre sobre todo los que no traen factura.
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

SELECT r.empresa_id, r.solicitante_usuario_id, r.requirente_usuario_id, IFNULL(r.encargado_compras_usuario_id, 0) AS encargado_usuario_id,
       r.entidad_requirente_id, r.fecha_requerimiento, r.total, IFNULL(r.observaciones, '') AS observaciones,
       COUNT(*) AS registros,
       GROUP_CONCAT(r.id ORDER BY r.id) AS ids,
       GROUP_CONCAT(r.codigo ORDER BY r.id) AS codigos,
       GROUP_CONCAT(r.estado ORDER BY r.id) AS estados,
       MIN(r.creado_en) AS primera_creacion, MAX(r.creado_en) AS ultima_creacion,
       TIMESTAMPDIFF(SECOND, MIN(r.creado_en), MAX(r.creado_en)) AS segundos_entre_extremos
FROM (
  SELECT h.*, (SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', l.orden, IFNULL(l.vehiculo_id, ''), IFNULL(l.unidad_descripcion, ''), l.fecha,
                                                  IFNULL(l.serie_factura, ''), IFNULL(l.numero_factura, ''), l.proveedor_id,
                                                  l.repuesto_descripcion, l.metodo_pago, l.condicion_pago, l.total,
                                                  IFNULL(l.observaciones, ''))
                           ORDER BY l.orden, l.id SEPARATOR ';;'))
               FROM u611730801_Plataforma.compras_requerimiento_lineas l
               WHERE l.empresa_id = h.empresa_id AND l.requerimiento_id = h.id) AS firma_lineas
  FROM u611730801_Plataforma.compras_requerimientos h
  WHERE h.empresa_id = @empresa_id AND h.creado_en >= @desde AND h.creado_en < @hasta
) r
GROUP BY r.empresa_id, r.solicitante_usuario_id, r.requirente_usuario_id, IFNULL(r.encargado_compras_usuario_id, 0),
         r.entidad_requirente_id, r.fecha_requerimiento, r.total, IFNULL(r.observaciones, ''), r.firma_lineas
HAVING COUNT(*) > 1 AND TIMESTAMPDIFF(SECOND, MIN(r.creado_en), MAX(r.creado_en)) <= @ventana_s
ORDER BY MIN(r.creado_en) DESC;

-- Después de aplicar la migración de idempotencia: cobertura de la protección (falla con "Unknown column" si aún no se aplicó).
SELECT COUNT(*) AS filas, SUM(clave_idempotencia IS NOT NULL) AS con_clave
FROM u611730801_Plataforma.compras_requerimientos WHERE empresa_id = @empresa_id;

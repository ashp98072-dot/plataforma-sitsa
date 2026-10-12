-- =====================================================================
-- DIAGNÓSTICO (SOLO LECTURA) — posible duplicado histórico: Solicitudes de Fondo 77 y 78
-- Archivo: sql/diagnostico-2026-10-fondos-77-78-duplicado.sql
--
-- SOLO SELECT (y un SET de variable de sesión para GROUP_CONCAT). NO modifica, elimina ni "corrige" nada: 77 y 78 son datos
-- históricos y esta herramienta solo permite REVISARLOS. Cualquier decisión sobre ellos (anular, rechazar, conservar ambos)
-- es del negocio y se haría aparte, con autorización explícita.
--
-- ESQUEMA EXPLÍCITO: tablas calificadas `u611730801_Plataforma.<tabla>`; no depende de DATABASE(). Sin ROW_COUNT().
-- id es la PK global de tms_solicitudes_fondo: 77 y 78 identifican una única fila cada uno (la empresa se muestra abajo).
-- =====================================================================

SET SESSION group_concat_max_len = 1000000;

-- 1) Cabeceras de las dos solicitudes (¿existen? ¿misma empresa? ¿estado?).
SELECT s.id, s.empresa_id, s.codigo, s.estado, s.fecha_requerimiento, s.total,
       s.entidad_requirente_id, s.requirente_usuario_id, s.requirente_nombre,
       s.solicitante_usuario_id, s.solicitante_nombre, s.creado_por, s.creado_en,
       s.autorizante_nombre, s.autorizado_en, s.rechazado_en, s.liquidado_en, s.observaciones
FROM u611730801_Plataforma.tms_solicitudes_fondo s
WHERE s.id IN (77, 78)
ORDER BY s.id;

-- 2) Comparación campo a campo de las cabeceras (1 = igual, 0 = distinto) y distancia en el tiempo entre ambas creaciones.
SELECT a.empresa_id = b.empresa_id AS misma_empresa,
       a.fecha_requerimiento <=> b.fecha_requerimiento AS misma_fecha,
       a.total <=> b.total AS mismo_total,
       a.entidad_requirente_id <=> b.entidad_requirente_id AS misma_entidad_requirente,
       a.requirente_usuario_id <=> b.requirente_usuario_id AS mismo_requirente_usuario,
       a.requirente_nombre <=> b.requirente_nombre AS mismo_requirente_nombre,
       a.solicitante_usuario_id <=> b.solicitante_usuario_id AS mismo_solicitante,
       a.creado_por <=> b.creado_por AS mismo_creador,
       a.observaciones <=> b.observaciones AS mismas_observaciones,
       a.estado AS estado_77, b.estado AS estado_78,
       TIMESTAMPDIFF(SECOND, a.creado_en, b.creado_en) AS segundos_entre_creaciones
FROM u611730801_Plataforma.tms_solicitudes_fondo a
JOIN u611730801_Plataforma.tms_solicitudes_fondo b ON b.id = 78
WHERE a.id = 77;

-- 3) Líneas de cada solicitud, en su orden.
SELECT l.solicitud_id, l.orden, l.id AS linea_id, l.categoria, l.descripcion, l.cantidad, l.monto,
       l.fecha_viaje, l.empleado_id, l.empleado_nombre, l.cargo, l.cuenta, l.metodo_pago,
       l.vehiculo_id, l.placa, l.cliente_id, l.cliente_nombre, l.plan_id
FROM u611730801_Plataforma.tms_solicitud_fondo_lineas l
WHERE l.solicitud_id IN (77, 78)
ORDER BY l.solicitud_id, l.orden, l.id;

-- 4) ¿Mismo detalle? Firma de líneas por solicitud (misma cantidad y mismo contenido en el mismo orden).
SELECT l.solicitud_id,
       COUNT(*) AS cantidad_lineas,
       SUM(l.cantidad * l.monto) AS suma_lineas,
       MD5(GROUP_CONCAT(CONCAT_WS('|', l.orden, l.categoria, IFNULL(l.descripcion, ''), l.cantidad, l.monto,
                                  IFNULL(l.fecha_viaje, ''), IFNULL(l.empleado_id, ''), IFNULL(l.cuenta, ''),
                                  IFNULL(l.metodo_pago, ''), IFNULL(l.vehiculo_id, ''), IFNULL(l.cliente_id, ''),
                                  IFNULL(l.plan_id, ''))
                           ORDER BY l.orden, l.id SEPARATOR ';;')) AS firma_lineas
FROM u611730801_Plataforma.tms_solicitud_fondo_lineas l
WHERE l.solicitud_id IN (77, 78)
GROUP BY l.solicitud_id
ORDER BY l.solicitud_id;

-- 5) Firmas electrónicas capturadas para cada una (acción, quién, cuándo).
SELECT f.entidad_id AS solicitud_id, f.accion, f.usuario_id, f.fecha_hora_servidor
FROM u611730801_Plataforma.firmas_electronicas f
WHERE f.modulo = 'FONDOS' AND f.entidad_tipo = 'SOLICITUD_FONDO' AND f.entidad_id IN (77, 78)
ORDER BY f.entidad_id, f.fecha_hora_servidor, f.id;

-- 6) Auditoría asociada (creación y cambios de estado), por número de solicitud en el detalle.
SELECT a.id, a.empresa_id, a.usuario, a.accion, a.modulo, a.detalle, a.creado_en
FROM u611730801_Plataforma.auditoria a
WHERE a.modulo = 'tms_fondos'
  AND (a.detalle LIKE '%#77 %' OR a.detalle LIKE '%#78 %' OR a.detalle LIKE '%FONDO-000077%' OR a.detalle LIKE '%FONDO-000078%')
ORDER BY a.creado_en, a.id;

-- 7) Resumen para decidir (solo informativo): ¿cabecera Y detalle idénticos? ¿cuánto tiempo entre ambas?
SELECT (a.fecha_requerimiento <=> b.fecha_requerimiento AND a.total <=> b.total AND a.requirente_usuario_id <=> b.requirente_usuario_id
        AND a.solicitante_usuario_id <=> b.solicitante_usuario_id AND a.observaciones <=> b.observaciones
        AND a.entidad_requirente_id <=> b.entidad_requirente_id) AS cabecera_identica,
       (SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', l.orden, l.categoria, IFNULL(l.descripcion, ''), l.cantidad, l.monto, IFNULL(l.fecha_viaje, ''),
                                          IFNULL(l.empleado_id, ''), IFNULL(l.cuenta, ''), IFNULL(l.metodo_pago, ''), IFNULL(l.vehiculo_id, ''),
                                          IFNULL(l.cliente_id, ''), IFNULL(l.plan_id, '')) ORDER BY l.orden, l.id SEPARATOR ';;'))
          FROM u611730801_Plataforma.tms_solicitud_fondo_lineas l WHERE l.solicitud_id = 77)
       <=>
       (SELECT MD5(GROUP_CONCAT(CONCAT_WS('|', l.orden, l.categoria, IFNULL(l.descripcion, ''), l.cantidad, l.monto, IFNULL(l.fecha_viaje, ''),
                                          IFNULL(l.empleado_id, ''), IFNULL(l.cuenta, ''), IFNULL(l.metodo_pago, ''), IFNULL(l.vehiculo_id, ''),
                                          IFNULL(l.cliente_id, ''), IFNULL(l.plan_id, '')) ORDER BY l.orden, l.id SEPARATOR ';;'))
          FROM u611730801_Plataforma.tms_solicitud_fondo_lineas l WHERE l.solicitud_id = 78) AS detalle_identico,
       TIMESTAMPDIFF(SECOND, a.creado_en, b.creado_en) AS segundos_entre_creaciones,
       a.estado AS estado_77, b.estado AS estado_78
FROM u611730801_Plataforma.tms_solicitudes_fondo a
JOIN u611730801_Plataforma.tms_solicitudes_fondo b ON b.id = 78
WHERE a.id = 77;

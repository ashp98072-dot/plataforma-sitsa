-- SOLO LECTURA. Diagnóstico previo a decidir si las fichas #602 y #603 (Fresco Fresh, creadas por error) pueden eliminarse sin perder historial necesario.
-- Compara cada una con la ficha de Mónaco/Kuiqtrans que se considera correcta (#602 ↔ #1296 · #603 ↔ #1297) SIN asumir identidad por la placa.
-- Uso (phpMyAdmin, base de producción seleccionada): ejecutar sentencia por sentencia. Cada SELECT es independiente (si una tabla no existe, solo falla esa sección).
-- NO modifica nada: sin INSERT/UPDATE/DELETE/DDL/CALL/PREPARE/SET. Es una consulta administrativa (ve todas las empresas): no compartir resultados fuera del equipo responsable.
-- Objetivos: 602 y 603 (a eliminar) · 1296 y 1297 (fichas correctas). Para otra pareja, cambiar los números en cada sentencia.
--
-- Cómo leerlo:
--   A  fichas lado a lado        B  comparación por pareja (placa, chasis, km, estado)      C  dependencias por tabla y ficha
--   D  solicitudes de fondo      E  TMS (unidades, planes, gastos, compras)                 F  actividad operativa y archivos de Flota
--   G  qué bloquea y qué se perdería al eliminar (veredicto por ficha)
--   Regla de decisión: una ficha solo es candidata a eliminarse si la columna `bloqueos` de G es 0 y `se_perderia` solo contiene registros erróneos/sin ejecutar
--   confirmados por el responsable. Cualquier fila en D con estado Autorizada/Liquidada o importe > 0 es HISTORIA FINANCIERA: no se elimina ni se reasigna sin aprobación expresa.

-- A) Fichas completas, empresa y accesos.
SELECT v.*, e.nombre AS empresa_nombre, (SELECT GROUP_CONCAT(a.empresa_id ORDER BY a.empresa_id) FROM flota_vehiculo_acceso a WHERE a.vehiculo_id = v.id) AS accesos_empresas
FROM flota_vehiculos v LEFT JOIN empresas e ON e.id = v.empresa_id WHERE v.id IN (602, 603, 1296, 1297) ORDER BY v.id;

-- B) Comparación por pareja: ¿misma unidad? (placa comparable + tipo + chasis real). Sin chasis => NO acredita identidad.
SELECT p.objetivo, p.correcta, o.placa AS placa_objetivo, c.placa AS placa_correcta,
       REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(o.placa)),'‐','-'),'‑','-'),'–','-'),'—','-'),'[[:space:]-]','') = REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(c.placa)),'‐','-'),'‑','-'),'–','-'),'—','-'),'[[:space:]-]','') AS misma_placa_comparable,
       o.tipo_unidad AS tipo_objetivo, c.tipo_unidad AS tipo_correcta, o.chasis AS chasis_objetivo, c.chasis AS chasis_correcta,
       CASE WHEN IFNULL(TRIM(o.chasis),'') = '' OR IFNULL(TRIM(c.chasis),'') = '' THEN 'SIN CHASIS: no acredita identidad'
            WHEN REGEXP_REPLACE(UPPER(TRIM(o.chasis)),'[[:space:]]','') = REGEXP_REPLACE(UPPER(TRIM(c.chasis)),'[[:space:]]','') THEN 'MISMO CHASIS (confirmar con documento)'
            ELSE 'CHASIS DISTINTO: unidades distintas' END AS veredicto_identidad,
       o.km_actual AS km_objetivo, c.km_actual AS km_correcta, o.estado AS estado_objetivo, c.estado AS estado_correcta, o.activo AS activo_objetivo, c.activo AS activo_correcta,
       o.empresa_id AS empresa_objetivo, c.empresa_id AS empresa_correcta
FROM (SELECT 602 AS objetivo, 1296 AS correcta UNION ALL SELECT 603, 1297) p
JOIN flota_vehiculos o ON o.id = p.objetivo JOIN flota_vehiculos c ON c.id = p.correcta;

-- C) Dependencias por tabla y ficha (sin fila = 0). Incluye las 4 fichas: la correcta debe concentrar la actividad real.
SELECT 'flota_viajes' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, SUM(estado = 'abierto') AS abiertos, MIN(hora_salida) AS desde, MAX(hora_salida) AS hasta FROM flota_viajes WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'flota_lecturas' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, MIN(fecha_lectura) AS desde, MAX(fecha_lectura) AS hasta, MAX(km) AS km_max FROM flota_lecturas WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'flota_servicios' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, MIN(fecha_servicio) AS desde, MAX(fecha_servicio) AS hasta, SUM(costo) AS costo_total FROM flota_servicios WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'flota_vehiculo_filtros' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM flota_vehiculo_filtros WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'flota_vehiculo_documentos' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, SUM(ruta_relativa IS NOT NULL) AS con_archivo FROM flota_vehiculo_documentos WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'flota_combustible_cargas' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, SUM(monto) AS monto, MIN(creado_at) AS desde, MAX(creado_at) AS hasta FROM flota_combustible_cargas WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'flota_cb2_consumos' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, MIN(fecha_consumo) AS desde, MAX(fecha_consumo) AS hasta FROM flota_cb2_consumos WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'ops_multas_revisiones' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM ops_multas_revisiones WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'ops_multas' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM ops_multas WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;

-- D) Solicitudes de fondo que referencian las fichas (origen del error #1451: fk_fondolin_vehiculo ON DELETE RESTRICT).
-- D1) Resumen por ficha, empresa, estado de la solicitud: ¿hay dinero autorizado/liquidado?
SELECT l.vehiculo_id AS ficha, l.empresa_id AS empresa_de_la_solicitud, s.estado AS estado_solicitud, COUNT(*) AS lineas, COUNT(DISTINCT l.solicitud_id) AS solicitudes, SUM(l.monto) AS monto_lineas,
       MIN(s.fecha_requerimiento) AS desde, MAX(s.fecha_requerimiento) AS hasta, SUM(s.autorizado_en IS NOT NULL) AS lineas_autorizadas, SUM(s.liquidado_en IS NOT NULL) AS lineas_liquidadas
FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id
WHERE l.vehiculo_id IN (602, 603, 1296, 1297) GROUP BY l.vehiculo_id, l.empresa_id, s.estado ORDER BY l.vehiculo_id, s.estado;
-- D2) Detalle exacto de las líneas de #602 y #603 con su solicitud (para decidir una por una; la «placa» es el dato histórico guardado en la línea).
SELECT l.id AS linea_id, l.vehiculo_id AS ficha, l.placa AS placa_guardada, l.empresa_id, l.solicitud_id, s.codigo, s.estado, s.fecha_requerimiento, s.total AS total_solicitud,
       l.categoria, l.descripcion, l.cantidad, l.monto, l.fecha_viaje, l.empleado_nombre, l.plan_id, s.autorizante_nombre, s.autorizado_en, s.rechazado_en, s.liquidado_en, s.creado_por, s.creado_en,
       (SELECT COUNT(*) FROM tms_solicitud_fondo_lineas x WHERE x.empresa_id = l.empresa_id AND x.solicitud_id = l.solicitud_id) AS lineas_en_la_solicitud,
       (SELECT COUNT(*) FROM tms_solicitud_fondo_lineas x WHERE x.empresa_id = l.empresa_id AND x.solicitud_id = l.solicitud_id AND x.vehiculo_id IN (602, 603)) AS lineas_de_estas_fichas
FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id
WHERE l.vehiculo_id IN (602, 603) ORDER BY l.vehiculo_id, l.solicitud_id, l.id LIMIT 500;

-- E) TMS.
SELECT u.id AS unidad_tms, u.flota_vehiculo_id AS ficha, u.empresa_id, u.placa, (SELECT COUNT(*) FROM tms_planes_viaje p WHERE p.unidad_id = u.id) AS planes_con_esta_unidad FROM tms_unidades u WHERE u.flota_vehiculo_id IN (602, 603, 1296, 1297);
SELECT 'planes por tc_vehiculo_id' AS origen, p.tc_vehiculo_id AS ficha, p.estado, COUNT(*) AS planes, MIN(p.fecha_plan) AS desde, MAX(p.fecha_plan) AS hasta FROM tms_planes_viaje p WHERE p.tc_vehiculo_id IN (602, 603, 1296, 1297) GROUP BY p.tc_vehiculo_id, p.estado;
SELECT 'planes por unidad TMS ligada' AS origen, u.flota_vehiculo_id AS ficha, p.estado, COUNT(*) AS planes, MIN(p.fecha_plan) AS desde, MAX(p.fecha_plan) AS hasta FROM tms_planes_viaje p JOIN tms_unidades u ON u.id = p.unidad_id WHERE u.flota_vehiculo_id IN (602, 603, 1296, 1297) GROUP BY u.flota_vehiculo_id, p.estado;
SELECT 'tms_gastos_operativos' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, SUM(monto) AS monto FROM tms_gastos_operativos WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'compras_requerimiento_lineas' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM compras_requerimiento_lineas WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;
SELECT 'tms_viatico_requerimiento_lineas' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM tms_viatico_requerimiento_lineas WHERE vehiculo_id IN (602, 603, 1296, 1297) GROUP BY vehiculo_id;

-- F) Archivos físicos asociados (se perderían del disco si se borran las filas sin conservarlos).
SELECT 'documento de la ficha' AS origen, d.vehiculo_id AS ficha, d.id, d.tipo, d.estado, d.ruta_relativa, d.nombre_original, d.fecha_vencimiento FROM flota_vehiculo_documentos d WHERE d.vehiculo_id IN (602, 603) ORDER BY d.vehiculo_id, d.id LIMIT 200;
SELECT 'adjunto de servicio' AS origen, s.vehiculo_id AS ficha, a.id, a.ruta_relativa, a.nombre_original FROM flota_servicio_adjuntos a JOIN flota_servicios s ON s.id = a.servicio_id WHERE s.vehiculo_id IN (602, 603) ORDER BY s.vehiculo_id, a.id LIMIT 200;
SELECT 'evidencia de viaje' AS origen, v.vehiculo_id AS ficha, e.id, e.ruta_relativa FROM flota_viaje_evidencias e JOIN flota_viajes v ON v.id = e.viaje_id WHERE v.vehiculo_id IN (602, 603) ORDER BY v.vehiculo_id, e.id LIMIT 200;
SELECT 'evidencia de lectura' AS origen, l.vehiculo_id AS ficha, e.id, e.ruta_relativa FROM flota_lectura_evidencias e JOIN flota_lecturas l ON l.id = e.lectura_id WHERE l.vehiculo_id IN (602, 603) ORDER BY l.vehiculo_id, e.id LIMIT 200;

-- G) Identidad y alias, y veredicto por ficha: BLOQUEOS (RESTRICT: impiden eliminar) frente a SE PERDERÍA (CASCADE o sin clave foránea: se borra o queda huérfano).
SELECT 'identidad física' AS origen, m.vehiculo_id AS ficha, m.identidad_id FROM flota_identidad_miembros m WHERE m.vehiculo_id IN (602, 603, 1296, 1297);
SELECT 'alias de fusión' AS origen, f.origen_id, f.destino_id FROM flota_vehiculos_fusiones f WHERE f.origen_id IN (602, 603, 1296, 1297) OR f.destino_id IN (602, 603, 1296, 1297);
SELECT t.ficha,
       (SELECT COUNT(*) FROM tms_solicitud_fondo_lineas WHERE vehiculo_id = t.ficha) + (SELECT COUNT(*) FROM tms_gastos_operativos WHERE vehiculo_id = t.ficha)
       + (SELECT COUNT(*) FROM compras_requerimiento_lineas WHERE vehiculo_id = t.ficha) + (SELECT COUNT(*) FROM flota_cb2_consumos WHERE vehiculo_id = t.ficha)
       + (SELECT COUNT(*) FROM ops_multas_revisiones WHERE vehiculo_id = t.ficha) + (SELECT COUNT(*) FROM flota_identidad_miembros WHERE vehiculo_id = t.ficha)
       + (SELECT COUNT(*) FROM flota_vehiculos_fusiones WHERE origen_id = t.ficha OR destino_id = t.ficha) AS bloqueos,
       (SELECT COUNT(*) FROM flota_lecturas WHERE vehiculo_id = t.ficha) AS se_perderia_lecturas, (SELECT COUNT(*) FROM flota_servicios WHERE vehiculo_id = t.ficha) AS se_perderia_servicios,
       (SELECT COUNT(*) FROM flota_viajes WHERE vehiculo_id = t.ficha) AS se_perderia_viajes, (SELECT COUNT(*) FROM flota_vehiculo_filtros WHERE vehiculo_id = t.ficha) AS se_perderia_filtros,
       (SELECT COUNT(*) FROM flota_vehiculo_acceso WHERE vehiculo_id = t.ficha) AS se_perderia_accesos,
       (SELECT COUNT(*) FROM flota_vehiculo_documentos WHERE vehiculo_id = t.ficha) AS quedaria_huerfano_documentos, (SELECT COUNT(*) FROM flota_combustible_cargas WHERE vehiculo_id = t.ficha) AS quedaria_huerfano_cargas,
       (SELECT COUNT(*) FROM tms_unidades WHERE flota_vehiculo_id = t.ficha) AS tms_unidad_perderia_vinculo, (SELECT COUNT(*) FROM tms_planes_viaje WHERE tc_vehiculo_id = t.ficha) AS planes_tc
FROM (SELECT 602 AS ficha UNION ALL SELECT 603 UNION ALL SELECT 1296 UNION ALL SELECT 1297) t ORDER BY t.ficha;

-- SOLO LECTURA. Vista previa de conflictos ANTES de vincular (identidad física) o dar de baja una de dos fichas de la misma placa.
-- No fusiona, no mueve referencias y no modifica nada: sin INSERT/UPDATE/DELETE/DDL/CALL/PREPARE/SET.
-- Uso (phpMyAdmin, base de producción seleccionada): cambiar los dos IDs en CADA sentencia (hoy: 651 y 1300) y ejecutar una por una.
-- Cada SELECT es independiente: si una tabla no existe en tu instalación, solo esa sección falla.
-- Es una consulta administrativa (ve todas las empresas): no compartir los resultados fuera del equipo responsable.
--
-- Cómo leer el resultado:
--   1  fichas lado a lado (empresa dueña, chasis, km, estado). Chasis vacío o distinto => NO acreditan la misma unidad.
--   2  qué empresas ven cada ficha (compartición).
--   3  dependencias por tabla y ficha: lo que SE CONSERVA intacto (la identidad física no mueve nada) y lo que impide ELIMINAR.
--   4  CHOQUES de unicidad que ocurrirían si alguien unificara las fichas (la vista previa de un traslado de referencias, que NO se hace aquí).
--   5  operaciones abiertas que bloquean proponer/aprobar la identidad (viajes abiertos, planes vigentes, fondos pendientes).

-- 1) Fichas lado a lado.
SELECT v.id, v.empresa_id, e.nombre AS empresa_nombre, v.placa, v.tipo_unidad, v.chasis, v.marca, v.modelo, v.km_actual, v.estado, v.activo, v.en_taller
FROM flota_vehiculos v LEFT JOIN empresas e ON e.id = v.empresa_id WHERE v.id IN (651, 1300) ORDER BY v.id;

-- 2) Compartición.
SELECT a.vehiculo_id, a.empresa_id, e.nombre AS empresa_nombre FROM flota_vehiculo_acceso a LEFT JOIN empresas e ON e.id = a.empresa_id WHERE a.vehiculo_id IN (651, 1300) ORDER BY 1, 2;

-- 3) Dependencias por tabla y ficha (sin fila = 0).
SELECT 'flota_lecturas (CASCADE al borrar)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM flota_lecturas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_servicios (CASCADE al borrar)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM flota_servicios WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_viajes (CASCADE al borrar)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, SUM(estado = 'abierto') AS abiertos FROM flota_viajes WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_vehiculo_filtros' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM flota_vehiculo_filtros WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_vehiculo_documentos' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM flota_vehiculo_documentos WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_combustible_cargas (por vehículo)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM flota_combustible_cargas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_cb2_consumos (RESTRICT)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas, MIN(fecha_consumo) AS desde, MAX(fecha_consumo) AS hasta FROM flota_cb2_consumos WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'tms_unidades (al borrar queda sin vínculo)' AS tabla, flota_vehiculo_id AS ficha, COUNT(*) AS filas, GROUP_CONCAT(id) AS unidades_tms FROM tms_unidades WHERE flota_vehiculo_id IN (651, 1300) GROUP BY flota_vehiculo_id;
SELECT 'tms_planes_viaje.tc_vehiculo_id' AS tabla, tc_vehiculo_id AS ficha, COUNT(*) AS filas FROM tms_planes_viaje WHERE tc_vehiculo_id IN (651, 1300) GROUP BY tc_vehiculo_id;
SELECT 'tms_solicitud_fondo_lineas (RESTRICT)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM tms_solicitud_fondo_lineas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'tms_gastos_operativos (RESTRICT)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM tms_gastos_operativos WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'compras_requerimiento_lineas (RESTRICT)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM compras_requerimiento_lineas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'ops_multas (por vehículo)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM ops_multas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'ops_multas_revisiones (RESTRICT)' AS tabla, vehiculo_id AS ficha, COUNT(*) AS filas FROM ops_multas_revisiones WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;

-- 4) CHOQUES que ocurrirían al unificar las fichas (informativo: esta herramienta NO unifica ni reasigna).
-- 4a) Vales de combustible CB2 repetidos entre las dos fichas (la unicidad por vale/placa impediría reasignar uno a la otra).
SELECT a.numero_vale, a.vehiculo_id AS ficha_a, b.vehiculo_id AS ficha_b, a.fecha_consumo AS fecha_a, b.fecha_consumo AS fecha_b
FROM flota_cb2_consumos a JOIN flota_cb2_consumos b ON b.vale_norm = a.vale_norm AND b.vehiculo_id = 1300 AND b.id <> a.id
WHERE a.vehiculo_id = 651 ORDER BY a.numero_vale LIMIT 100;
-- 4b) Periodos de multas con revisión en AMBAS fichas.
SELECT a.periodo_anio, a.vehiculo_id AS ficha_a, b.vehiculo_id AS ficha_b
FROM ops_multas_revisiones a JOIN ops_multas_revisiones b ON b.periodo_anio = a.periodo_anio AND b.vehiculo_id = 1300 WHERE a.vehiculo_id = 651;
-- 4c) Unidades TMS distintas ligadas a las dos fichas (dejarían la identidad TMS ambigua).
SELECT u.id AS unidad_tms, u.flota_vehiculo_id AS ficha, u.placa, u.empresa_id FROM tms_unidades u WHERE u.flota_vehiculo_id IN (651, 1300);
-- 4d) Misma placa comparable con chasis distinto o ausente (no acredita identidad).
SELECT REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(v.placa)),'‐','-'),'‑','-'),'–','-'),'—','-'),'[[:space:]-]','') AS placa_comparable,
       COUNT(DISTINCT REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','')) AS chasis_distintos,
       SUM(IFNULL(TRIM(v.chasis),'') = '') AS fichas_sin_chasis
FROM flota_vehiculos v WHERE v.id IN (651, 1300) GROUP BY 1;

-- 5) Operaciones abiertas que bloquean proponer/aprobar la identidad.
SELECT 'viajes abiertos' AS que, vehiculo_id AS ficha, COUNT(*) AS filas FROM flota_viajes WHERE vehiculo_id IN (651, 1300) AND estado = 'abierto' GROUP BY vehiculo_id;
SELECT 'planes TMS vigentes' AS que, tc_vehiculo_id AS ficha, COUNT(*) AS filas FROM tms_planes_viaje WHERE tc_vehiculo_id IN (651, 1300) AND (estado NOT IN ('Cerrado','Cancelado') OR fecha_plan >= CURRENT_DATE) GROUP BY tc_vehiculo_id;
SELECT 'solicitudes de fondo pendientes' AS que, l.vehiculo_id AS ficha, COUNT(*) AS filas FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id WHERE l.vehiculo_id IN (651, 1300) AND s.estado = 'Pendiente' GROUP BY l.vehiculo_id;

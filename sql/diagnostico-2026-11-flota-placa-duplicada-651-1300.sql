-- SOLO LECTURA. Diagnóstico de la placa duplicada C-092BXF: vehículos #651 y #1300 de Flota (y las demás placas duplicadas).
-- Uso (phpMyAdmin, base de producción seleccionada): ejecutar sección por sección. Cada sentencia es un SELECT independiente:
-- si una tabla no existe en tu instalación, esa sección da error y las demás siguen valiendo.
-- NO modifica nada: sin INSERT/UPDATE/DELETE/DDL/CALL/PREPARE/SET. Los IDs están como literales: cambia 651 y 1300 para otro par.
-- ADVERTENCIA: es una consulta administrativa de base de datos (ve todas las empresas). No pegar sus resultados fuera del equipo responsable.
--
-- Cómo leerlo:
--   A  las dos fichas completas y a qué empresa pertenecen (¿misma empresa o distinta? la FUSIÓN actual exige MISMA empresa).
--   B  con qué empresas se comparte cada ficha (flota_vehiculo_acceso).
--   C  alias de fusión ya registrados (debe estar vacío para estos IDs).
--   D  identidad física propuesta/aprobada (el mecanismo para unir fichas de DISTINTAS empresas sin mover historial).
--   E  dependencias por ficha: cuántas filas de cada tabla apuntan a #651 y a #1300 (qué impide eliminar y qué se conserva).
--   F  inventario de columnas que referencian vehículos (por si existe una tabla no listada en E).
--   G  las demás placas con varios registros (misma placa comparable en cualquier empresa).

-- A) Fichas completas.
SELECT v.*, e.nombre AS empresa_duena_nombre
FROM flota_vehiculos v LEFT JOIN empresas e ON e.id = v.empresa_id
WHERE v.id IN (651, 1300) ORDER BY v.id;

-- A2) ¿Misma placa comparable, mismo tipo y mismo chasis? (requisitos de identidad física y de fusión)
SELECT v.id, v.empresa_id, v.placa,
       REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(v.placa)),'‐','-'),'‑','-'),'–','-'),'—','-'),'[[:space:]-]','') AS placa_comparable,
       v.tipo_unidad, v.chasis, REGEXP_REPLACE(UPPER(TRIM(v.chasis)),'[[:space:]]','') AS chasis_comparable,
       v.marca, v.modelo, v.km_actual, v.estado, v.activo, v.en_taller
FROM flota_vehiculos v WHERE v.id IN (651, 1300) ORDER BY v.id;

-- B) Empresas con acceso a cada ficha (compartición).
SELECT a.vehiculo_id, a.empresa_id, e.nombre AS empresa_nombre
FROM flota_vehiculo_acceso a LEFT JOIN empresas e ON e.id = a.empresa_id
WHERE a.vehiculo_id IN (651, 1300) ORDER BY a.vehiculo_id, a.empresa_id;

-- C) Alias de fusión previos (origen o destino).
SELECT f.* FROM flota_vehiculos_fusiones f WHERE f.origen_id IN (651, 1300) OR f.destino_id IN (651, 1300);

-- D) Identidades físicas de ambas fichas (membresía, estado y aprobaciones por empresa).
SELECT m.vehiculo_id, m.empresa_id, i.id AS identidad_id, i.estado, i.placa_comparable, i.tipo_unidad, i.chasis_comparable, i.motivo
FROM flota_identidad_miembros m JOIN flota_identidades_fisicas i ON i.id = m.identidad_id
WHERE m.vehiculo_id IN (651, 1300);
SELECT ap.identidad_id, ap.empresa_id, ap.administrador_id, ap.creado_en
FROM flota_identidad_aprobaciones ap
WHERE ap.identidad_id IN (SELECT identidad_id FROM flota_identidad_miembros WHERE vehiculo_id IN (651, 1300));

-- E) Dependencias por ficha (cada SELECT cuenta filas que apuntan a #651 y #1300; sin fila = 0 referencias).
SELECT 'flota_viajes' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, SUM(estado='abierto') AS abiertos FROM flota_viajes WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_lecturas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, MAX(fecha_lectura) AS ultima FROM flota_lecturas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_servicios' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM flota_servicios WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_vehiculo_filtros' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM flota_vehiculo_filtros WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'flota_cb2_consumos' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, MIN(fecha_consumo) AS desde, MAX(fecha_consumo) AS hasta FROM flota_cb2_consumos WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'tms_planes_viaje.tc_vehiculo_id' AS tabla, tc_vehiculo_id AS vehiculo, COUNT(*) AS filas, SUM(estado NOT IN ('Cerrado','Cancelado') OR fecha_plan >= CURRENT_DATE) AS vigentes FROM tms_planes_viaje WHERE tc_vehiculo_id IN (651, 1300) GROUP BY tc_vehiculo_id;
SELECT 'tms_unidades' AS tabla, flota_vehiculo_id AS vehiculo, COUNT(*) AS filas, GROUP_CONCAT(id) AS unidades_tms FROM tms_unidades WHERE flota_vehiculo_id IN (651, 1300) GROUP BY flota_vehiculo_id;
SELECT 'tms_solicitud_fondo_lineas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM tms_solicitud_fondo_lineas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'tms_gastos_operativos' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM tms_gastos_operativos WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'compras_requerimiento_lineas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM compras_requerimiento_lineas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'ops_multas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM ops_multas WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;
SELECT 'ops_multas_revisiones' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM ops_multas_revisiones WHERE vehiculo_id IN (651, 1300) GROUP BY vehiculo_id;

-- F) Todas las columnas que referencian vehículos (FK real a flota_vehiculos o nombre *vehiculo_id) y su engine.
SELECT c.TABLE_NAME, c.COLUMN_NAME, t.ENGINE,
       (SELECT k.CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA AND k.TABLE_NAME = c.TABLE_NAME AND k.COLUMN_NAME = c.COLUMN_NAME AND k.REFERENCED_TABLE_NAME = 'flota_vehiculos' LIMIT 1) AS fk_a_flota_vehiculos
FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
WHERE c.TABLE_SCHEMA = DATABASE() AND c.TABLE_NAME <> 'flota_vehiculos' AND (c.COLUMN_NAME REGEXP 'vehiculo.*_id$' OR c.COLUMN_NAME = 'unidad_recurrente_id')
ORDER BY c.TABLE_NAME, c.COLUMN_NAME;

-- G) Demás placas con varios registros (misma placa comparable, cualquier empresa): grupos y estado de identidad.
SELECT g.placa_comparable, COUNT(*) AS registros, GROUP_CONCAT(g.id ORDER BY g.id) AS ids, GROUP_CONCAT(g.empresa_id ORDER BY g.id) AS empresas,
       GROUP_CONCAT(g.activo ORDER BY g.id) AS activos, COUNT(DISTINCT g.chasis_comparable) AS chasis_distintos, COUNT(DISTINCT g.tipo_unidad) AS tipos_distintos,
       SUM(g.en_identidad) AS en_identidad_fisica
FROM (
  SELECT v.id, v.empresa_id, v.activo, v.tipo_unidad,
         REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(v.placa)),'‐','-'),'‑','-'),'–','-'),'—','-'),'[[:space:]-]','') AS placa_comparable,
         REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') AS chasis_comparable,
         EXISTS (SELECT 1 FROM flota_identidad_miembros m WHERE m.vehiculo_id = v.id) AS en_identidad
  FROM flota_vehiculos v
) g
GROUP BY g.placa_comparable HAVING COUNT(*) > 1
ORDER BY g.placa_comparable;

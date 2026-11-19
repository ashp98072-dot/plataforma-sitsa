-- SOLO LECTURA. Control de las 5 parejas de placas duplicadas entre empresas, SIN asumir que sean el mismo vehículo físico.
-- Parejas: 651/1300 (C-092BXF), 602/1296 (C-034BXR), 603/1297 (C-035BXR), 684/1301 (C-558BSJ), 638/1299 (C-845BXG).
-- Uso (phpMyAdmin, base de producción seleccionada): ejecutar sentencia por sentencia. Cada SELECT es independiente (si una tabla no existe, solo esa falla).
-- NO modifica nada: sin INSERT/UPDATE/DELETE/DDL/CALL/PREPARE/SET. Es una consulta administrativa (ve todas las empresas): no compartir resultados fuera del equipo responsable.
--
-- Cómo leer el VEREDICTO de la sección B (por pareja; mismas reglas que identidad-fisica.ts y el trigger fifi_nueva):
--   SIN CHASIS EN UNA O MAS FICHAS ... no se puede proponer identidad física. Cada empresa dueña debe registrar el chasis real, con documento (tarjeta de circulación).
--   CHASIS NO VALIDO .................. el chasis es placeholder (repetido, DESCONOCIDO, PENDIENTE, SINDATO, NOAPLICA) o tiene menos de 6/más de 32 caracteres.
--   CHASIS DISTINTO ................... son UNIDADES DISTINTAS que comparten placa (placa reutilizada): NO unir; revisar cuál está vigente.
--   TIPO DISTINTO ..................... mismo caso: no son la misma unidad.
--   FICHA INACTIVA O EN TALLER ........ la identidad exige fichas activas y fuera de taller.
--   CANDIDATA A IDENTIDAD FISICA ...... mismo chasis real, tipo y placa: puede proponerse en Flota > CB2 > Identidades físicas y ser aprobada por cada empresa dueña. NO es una prueba: confirmar contra el documento.
--   IDENTIDAD YA REGISTRADA ........... alguna ficha ya pertenece a una identidad física (ver C).

-- A) Las 10 fichas: empresa dueña, chasis tal cual y normalizado, estado y compartición.
SELECT v.id, v.empresa_id, e.nombre AS empresa_nombre, v.placa, v.tipo_unidad, v.marca, v.modelo, v.chasis,
       REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') AS chasis_comparable,
       v.km_actual, v.estado, v.activo, v.en_taller,
       (SELECT GROUP_CONCAT(a.empresa_id ORDER BY a.empresa_id) FROM flota_vehiculo_acceso a WHERE a.vehiculo_id = v.id) AS compartida_con_empresas
FROM flota_vehiculos v LEFT JOIN empresas e ON e.id = v.empresa_id
WHERE v.id IN (651,1300,602,1296,603,1297,684,1301,638,1299)
ORDER BY REGEXP_REPLACE(REPLACE(REPLACE(UPPER(TRIM(v.placa)),'-',''),' ',''),'[[:space:]]',''), v.id;

-- B) Veredicto por pareja (agrupado por placa comparable; sin asumir identidad).
SELECT p.placa_comparable, GROUP_CONCAT(p.id ORDER BY p.id) AS fichas, GROUP_CONCAT(p.empresa_id ORDER BY p.id) AS empresas,
       CASE
         WHEN SUM(p.en_identidad) > 0 THEN 'IDENTIDAD YA REGISTRADA'
         WHEN SUM(p.chasis_comparable = '') > 0 THEN 'SIN CHASIS EN UNA O MAS FICHAS'
         WHEN SUM(p.chasis_valido = 0) > 0 THEN 'CHASIS NO VALIDO'
         WHEN COUNT(DISTINCT p.chasis_comparable) > 1 THEN 'CHASIS DISTINTO: UNIDADES DISTINTAS, NO UNIR'
         WHEN COUNT(DISTINCT p.tipo_unidad) > 1 THEN 'TIPO DISTINTO: UNIDADES DISTINTAS, NO UNIR'
         WHEN SUM(p.activo = 1 AND p.estado = 'Activo' AND IFNULL(p.en_taller,0) = 0) < COUNT(*) THEN 'FICHA INACTIVA O EN TALLER'
         ELSE 'CANDIDATA A IDENTIDAD FISICA (confirmar con documento)'
       END AS veredicto
FROM (
  SELECT v.id, v.empresa_id, v.tipo_unidad, v.activo, v.estado, v.en_taller,
         REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(UPPER(TRIM(v.placa)),'‐','-'),'‑','-'),'–','-'),'—','-'),'[[:space:]-]','') AS placa_comparable,
         REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') AS chasis_comparable,
         (REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') REGEXP '^[A-Z0-9]{6,32}$'
          AND NOT REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') REGEXP '^(.)\\1+$'
          AND REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') NOT IN ('DESCONOCIDO','PENDIENTE','SINDATO','NOAPLICA')) AS chasis_valido,
         EXISTS (SELECT 1 FROM flota_identidad_miembros m WHERE m.vehiculo_id = v.id) AS en_identidad
  FROM flota_vehiculos v WHERE v.id IN (651,1300,602,1296,603,1297,684,1301,638,1299)
) p
GROUP BY p.placa_comparable ORDER BY p.placa_comparable;

-- C) Identidades físicas y aprobaciones de estas fichas (esperado: vacío antes de proponer).
SELECT m.vehiculo_id, m.empresa_id, i.id AS identidad_id, i.estado FROM flota_identidad_miembros m JOIN flota_identidades_fisicas i ON i.id = m.identidad_id
WHERE m.vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299);

-- D) Dependencias por ficha (sin fila = 0 referencias). Es lo que se conserva intacto: la identidad física NO mueve nada.
SELECT 'flota_viajes' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, SUM(estado='abierto') AS abiertos FROM flota_viajes WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'flota_lecturas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, MAX(fecha_lectura) AS ultima FROM flota_lecturas WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'flota_servicios' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM flota_servicios WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'flota_vehiculo_filtros' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM flota_vehiculo_filtros WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'flota_cb2_consumos' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, MIN(fecha_consumo) AS desde, MAX(fecha_consumo) AS hasta FROM flota_cb2_consumos WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'tms_planes_viaje.tc_vehiculo_id' AS tabla, tc_vehiculo_id AS vehiculo, COUNT(*) AS filas, SUM(estado NOT IN ('Cerrado','Cancelado') OR fecha_plan >= CURRENT_DATE) AS vigentes FROM tms_planes_viaje WHERE tc_vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY tc_vehiculo_id;
SELECT 'tms_unidades' AS tabla, flota_vehiculo_id AS vehiculo, COUNT(*) AS filas, GROUP_CONCAT(id) AS unidades_tms FROM tms_unidades WHERE flota_vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY flota_vehiculo_id;
SELECT 'tms_solicitud_fondo_lineas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM tms_solicitud_fondo_lineas WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'tms_gastos_operativos' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM tms_gastos_operativos WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'compras_requerimiento_lineas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM compras_requerimiento_lineas WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'ops_multas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM ops_multas WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;
SELECT 'ops_multas_revisiones' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM ops_multas_revisiones WHERE vehiculo_id IN (651,1300,602,1296,603,1297,684,1301,638,1299) GROUP BY vehiculo_id;

-- SOLO LECTURA. HUELLA y POSTCHECK para las fichas #602 (baja reversible) y #603 (eliminación controlada).
-- Se ejecuta ANTES de cualquier cambio (para guardar la huella de referencia) y DESPUÉS (para compararla). Los resultados de ANTES y DESPUÉS deben ser idénticos
-- salvo lo que se indica como «cambia esperado». Sin INSERT/UPDATE/DELETE/DDL/CALL/PREPARE/SET.
-- Es una consulta administrativa (ve todas las empresas): no compartir resultados fuera del equipo responsable.

-- H1) HUELLA de la solicitud de fondos FONDO-000135 (histórica, Liquidada): NO debe cambiar nunca. Guardar el resultado de ANTES.
SELECT s.id AS solicitud_id, s.codigo, s.estado, s.total, s.autorizado_en, s.liquidado_en, COUNT(l.id) AS lineas, SUM(l.monto) AS suma_lineas,
       SUM(l.vehiculo_id = 602) AS lineas_de_602, SUM(CASE WHEN l.vehiculo_id = 602 THEN l.monto ELSE 0 END) AS monto_de_602,
       MD5(GROUP_CONCAT(CONCAT_WS('|', l.id, l.vehiculo_id, l.placa, l.categoria, l.cantidad, l.monto, l.fecha_viaje, IFNULL(l.empleado_id, ''), IFNULL(l.plan_id, '')) ORDER BY l.id SEPARATOR ';')) AS huella_lineas
FROM tms_solicitudes_fondo s JOIN tms_solicitud_fondo_lineas l ON l.empresa_id = s.empresa_id AND l.solicitud_id = s.id WHERE s.codigo = 'FONDO-000135' GROUP BY s.id, s.codigo, s.estado, s.total, s.autorizado_en, s.liquidado_en;

-- H2) Estado de #602 y #603 (cambia esperado: #602 activo 1 → 0 y estado Activo → Inactivo SOLO tras la baja; #603 deja de existir SOLO tras la eliminación).
SELECT v.id, v.empresa_id, v.placa, v.activo, v.estado, v.en_taller, v.km_actual FROM flota_vehiculos v WHERE v.id IN (602, 603, 1296, 1297) ORDER BY v.id;

-- H3) Lo que debe PERMANECER intacto de #602 tras la baja: filtros (3), acceso (1), líneas de fondo (2).
SELECT '602 filtros' AS que, COUNT(*) AS filas FROM flota_vehiculo_filtros WHERE vehiculo_id = 602
UNION ALL SELECT '602 accesos', COUNT(*) FROM flota_vehiculo_acceso WHERE vehiculo_id = 602
UNION ALL SELECT '602 lineas de fondo', COUNT(*) FROM tms_solicitud_fondo_lineas WHERE vehiculo_id = 602;

-- H4) Fichas correctas: NO deben cambiar (líneas de fondo, compras, unidad TMS y planes).
SELECT f.ficha,
       (SELECT COUNT(*) FROM tms_solicitud_fondo_lineas WHERE vehiculo_id = f.ficha) AS lineas_fondo, (SELECT IFNULL(SUM(monto), 0) FROM tms_solicitud_fondo_lineas WHERE vehiculo_id = f.ficha) AS monto_fondo,
       (SELECT COUNT(*) FROM compras_requerimiento_lineas WHERE vehiculo_id = f.ficha) AS lineas_compras,
       (SELECT GROUP_CONCAT(u.id) FROM tms_unidades u WHERE u.flota_vehiculo_id = f.ficha) AS unidad_tms,
       (SELECT COUNT(*) FROM tms_planes_viaje p JOIN tms_unidades u ON u.id = p.unidad_id WHERE u.flota_vehiculo_id = f.ficha) AS planes_tms
FROM (SELECT 1296 AS ficha UNION ALL SELECT 1297) f ORDER BY f.ficha;

-- H5) Integridad global (no deben cambiar): número de claves foráneas hacia flota_vehiculos y de fichas por empresa.
SELECT COUNT(*) AS claves_foraneas_hacia_flota_vehiculos FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = 'flota_vehiculos';
SELECT empresa_id, COUNT(*) AS fichas, SUM(activo = 1) AS activas FROM flota_vehiculos GROUP BY empresa_id ORDER BY empresa_id;

-- H6) SOLO tras eliminar #603 (esperado: todo 0 / sin filas): la ficha y sus accesos ya no existen y no quedó ninguna referencia suelta.
SELECT 'ficha 603 existe' AS que, COUNT(*) AS filas FROM flota_vehiculos WHERE id = 603
UNION ALL SELECT 'accesos de 603', COUNT(*) FROM flota_vehiculo_acceso WHERE vehiculo_id = 603
UNION ALL SELECT 'filtros de 603', COUNT(*) FROM flota_vehiculo_filtros WHERE vehiculo_id = 603
UNION ALL SELECT 'documentos de 603', COUNT(*) FROM flota_vehiculo_documentos WHERE vehiculo_id = 603
UNION ALL SELECT 'cargas de 603', COUNT(*) FROM flota_combustible_cargas WHERE vehiculo_id = 603
UNION ALL SELECT 'lineas de fondo de 603', COUNT(*) FROM tms_solicitud_fondo_lineas WHERE vehiculo_id = 603
UNION ALL SELECT 'unidad TMS ligada a 603', COUNT(*) FROM tms_unidades WHERE flota_vehiculo_id = 603;
-- (además, volver a ejecutar el generador P3 del preflight: debe devolver 0 filas en TODAS las columnas).

-- H7) Duplicados que quedan en catálogos de operaciones (activos, misma placa en empresas distintas): tras la baja de #602 y la eliminación de #603 no deben aparecer estas placas.
SELECT REGEXP_REPLACE(UPPER(placa), '[[:space:]-]', '') AS placa_comparable, COUNT(*) AS fichas_activas, GROUP_CONCAT(id ORDER BY id) AS ids, GROUP_CONCAT(empresa_id ORDER BY id) AS empresas
FROM flota_vehiculos WHERE activo = 1 AND REGEXP_REPLACE(UPPER(placa), '[[:space:]-]', '') IN ('C034BXR', 'C035BXR') GROUP BY 1;

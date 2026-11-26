-- SOLO LECTURA (Fase 0 identidad maestra). SQL requerido: SÍ, únicamente SELECT, ejecución MANUAL por el responsable en producción.
-- Parejas: #602/#1296 (C-034BXR) y #603/#1297 (C-035BXR). NO modifica nada: sin INSERT/UPDATE/DELETE/DDL/CALL/PREPARE/SET.
-- Consulta administrativa (ve varias empresas): no compartir resultados fuera del equipo responsable. No pegar el chasis en canales públicos.
-- Cada SELECT es independiente. El resultado se contrasta con la TARJETA DE CIRCULACIÓN física; la coincidencia de placa NO acredita identidad.

-- A) Datos registrados por ficha (chasis tal cual y comparable, tipo, propietario registrado = empresa dueña y NIT).
SELECT v.id, v.empresa_id, e.nombre AS empresa_dueña, v.placa, v.tipo_unidad, v.marca, v.modelo, v.chasis,
       REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') AS chasis_comparable,
       v.nit, v.condicion_propiedad, v.estado, v.activo, v.en_taller, v.km_actual
FROM flota_vehiculos v LEFT JOIN empresas e ON e.id = v.empresa_id
WHERE v.id IN (602,1296,603,1297) ORDER BY v.id;

-- B) Documentos cargados por ficha (¿hay tarjeta de circulación escaneada?). No se lee el archivo: solo metadatos.
SELECT d.vehiculo_id, d.empresa_id, d.tipo, d.estado, d.fecha_vencimiento, d.nombre_original, d.creado_at, d.subido_por
FROM flota_vehiculo_documentos d WHERE d.vehiculo_id IN (602,1296,603,1297) ORDER BY d.vehiculo_id, d.tipo;

-- C) Veredicto por pareja con las mismas reglas que identidad-fisica.ts y el trigger fifi_nueva.
SELECT p.par, GROUP_CONCAT(p.id ORDER BY p.id) AS fichas,
  CASE
    WHEN SUM(p.en_identidad) > 0 THEN 'IDENTIDAD YA REGISTRADA'
    WHEN SUM(p.chasis_comparable = '') > 0 THEN 'PENDIENTE DE ACREDITACION: sin chasis en una o mas fichas'
    WHEN SUM(p.chasis_valido = 0) > 0 THEN 'PENDIENTE DE ACREDITACION: chasis no valido'
    WHEN COUNT(DISTINCT p.chasis_comparable) > 1 THEN 'NO-GO: chasis distinto (unidades distintas)'
    WHEN COUNT(DISTINCT p.tipo_unidad) > 1 THEN 'NO-GO: tipo distinto'
    ELSE 'COINCIDE EN SISTEMA: falta contrastar con la tarjeta fisica'
  END AS veredicto_sistema
FROM (
  SELECT v.id, v.tipo_unidad, IF(v.id IN (602,1296),'C-034BXR (602/1296)','C-035BXR (603/1297)') AS par,
         REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') AS chasis_comparable,
         (REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') REGEXP '^[A-Z0-9]{6,32}$'
          AND NOT REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') REGEXP '^(.)\1+$'
          AND REGEXP_REPLACE(UPPER(TRIM(IFNULL(v.chasis,''))),'[[:space:]]','') NOT IN ('DESCONOCIDO','PENDIENTE','SINDATO','NOAPLICA')) AS chasis_valido,
         EXISTS (SELECT 1 FROM flota_identidad_miembros m WHERE m.vehiculo_id = v.id) AS en_identidad
  FROM flota_vehiculos v WHERE v.id IN (602,1296,603,1297)
) p GROUP BY p.par;

-- D) Relaciones existentes (sin fila = 0). Se conservan intactas: la identidad física no mueve nada.
SELECT 'flota_viajes' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, SUM(estado='abierto') AS abiertos FROM flota_viajes WHERE vehiculo_id IN (602,1296,603,1297) GROUP BY vehiculo_id;
SELECT 'flota_cb2_consumos' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM flota_cb2_consumos WHERE vehiculo_id IN (602,1296,603,1297) GROUP BY vehiculo_id;
SELECT 'tms_unidades' AS tabla, flota_vehiculo_id AS vehiculo, COUNT(*) AS filas, GROUP_CONCAT(id) AS unidades_tms FROM tms_unidades WHERE flota_vehiculo_id IN (602,1296,603,1297) GROUP BY flota_vehiculo_id;
SELECT 'tms_solicitud_fondo_lineas' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM tms_solicitud_fondo_lineas WHERE vehiculo_id IN (602,1296,603,1297) GROUP BY vehiculo_id;
SELECT 'tms_gastos_operativos' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas FROM tms_gastos_operativos WHERE vehiculo_id IN (602,1296,603,1297) GROUP BY vehiculo_id;
SELECT 'flota_vehiculo_acceso' AS tabla, vehiculo_id AS vehiculo, COUNT(*) AS filas, GROUP_CONCAT(empresa_id) AS empresas FROM flota_vehiculo_acceso WHERE vehiculo_id IN (602,1296,603,1297) GROUP BY vehiculo_id;
SELECT m.vehiculo_id, m.empresa_id, i.id AS identidad_id, i.estado FROM flota_identidad_miembros m JOIN flota_identidades_fisicas i ON i.id = m.identidad_id WHERE m.vehiculo_id IN (602,1296,603,1297);

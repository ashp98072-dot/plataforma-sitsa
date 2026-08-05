-- =============================================================================
-- Vaciar SOLO Flota / Predios de una empresa
-- NO toca: RRHH, TMS/Operaciones, Contabilidad, Usuarios
-- =============================================================================
SET @codigo_empresa = 'KT';

SELECT id INTO @empresa_id
FROM empresas
WHERE codigo = @codigo_empresa
LIMIT 1;

SELECT
  @empresa_id AS empresa_id,
  (SELECT COUNT(*) FROM flota_vehiculos WHERE empresa_id = @empresa_id) AS vehiculos,
  (SELECT COUNT(*) FROM flota_viajes WHERE empresa_id = @empresa_id) AS viajes,
  (SELECT COUNT(*) FROM empleados WHERE empresa_id = @empresa_id) AS empleados_NO_se_borran,
  (SELECT COUNT(*) FROM tms_planes_viaje WHERE empresa_id = @empresa_id) AS planes_tms_NO_se_borran;

START TRANSACTION;

DELETE FROM flota_viaje_evidencias WHERE empresa_id = @empresa_id;
DELETE FROM flota_lectura_evidencias WHERE empresa_id = @empresa_id;
DELETE FROM flota_servicio_adjuntos WHERE empresa_id = @empresa_id;
DELETE FROM flota_lecturas WHERE empresa_id = @empresa_id;
DELETE FROM flota_servicios WHERE empresa_id = @empresa_id;
DELETE FROM flota_viajes WHERE empresa_id = @empresa_id;
DELETE FROM flota_permisos_externos WHERE empresa_id = @empresa_id;
DELETE FROM flota_vehiculo_acceso WHERE empresa_id = @empresa_id;
DELETE a FROM flota_vehiculo_acceso a
INNER JOIN flota_vehiculos v ON v.id = a.vehiculo_id
WHERE v.empresa_id = @empresa_id;
DELETE FROM flota_vehiculos WHERE empresa_id = @empresa_id;

COMMIT;

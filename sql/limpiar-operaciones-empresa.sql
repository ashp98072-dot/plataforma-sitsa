-- =============================================================================
-- Vaciar SOLO Operaciones / TMS de una empresa
-- NO toca: RRHH, Flota (vehículos/viajes), Contabilidad, Usuarios
-- Desvincula plan_id en flota_viajes (no borra los viajes)
-- =============================================================================
SET @codigo_empresa = 'KT';

SELECT id INTO @empresa_id
FROM empresas
WHERE codigo = @codigo_empresa
LIMIT 1;

SELECT
  @empresa_id AS empresa_id,
  (SELECT COUNT(*) FROM tms_planes_viaje WHERE empresa_id = @empresa_id) AS planes,
  (SELECT COUNT(*) FROM flota_vehiculos WHERE empresa_id = @empresa_id) AS vehiculos_NO_se_borran,
  (SELECT COUNT(*) FROM empleados WHERE empresa_id = @empresa_id) AS empleados_NO_se_borran;

START TRANSACTION;

UPDATE flota_viajes
SET plan_id = NULL
WHERE empresa_id = @empresa_id AND plan_id IS NOT NULL;

DELETE FROM tms_evidencias WHERE empresa_id = @empresa_id;

DELETE a FROM tms_plan_auxiliares a
INNER JOIN tms_planes_viaje p ON p.id = a.plan_id
WHERE p.empresa_id = @empresa_id;

DELETE pp FROM tms_plan_paradas pp
INNER JOIN tms_planes_viaje p ON p.id = pp.plan_id
WHERE p.empresa_id = @empresa_id;

DELETE FROM tms_planes_viaje WHERE empresa_id = @empresa_id;
DELETE FROM tms_personal WHERE empresa_id = @empresa_id;
DELETE FROM tms_unidades WHERE empresa_id = @empresa_id;
DELETE FROM tms_lugares WHERE empresa_id = @empresa_id;
DELETE FROM tms_clientes WHERE empresa_id = @empresa_id;

COMMIT;

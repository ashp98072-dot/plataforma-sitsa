-- =============================================================================
-- Vaciar SOLO datos de RRHH de una empresa (ej. KT / Kuiqtrans)
-- NO toca: Operaciones (TMS), Flota/Predios, Contabilidad, CMS, Usuarios
-- =============================================================================
-- USO:
--   1) Revisa el SELECT de verificación.
--   2) Cambia @codigo_empresa si no es 'KT'.
--   3) Si estabas a medias: ejecuta ROLLBACK; y luego este script completo.
-- =============================================================================

SET @codigo_empresa = 'KT';

SELECT id INTO @empresa_id
FROM empresas
WHERE codigo = @codigo_empresa
LIMIT 1;

SELECT
  @empresa_id AS empresa_id,
  (SELECT COUNT(*) FROM empleados WHERE empresa_id = @empresa_id) AS empleados,
  (SELECT COUNT(*) FROM sesiones_trabajo WHERE empresa_id = @empresa_id) AS marcajes,
  (SELECT COUNT(*) FROM flota_vehiculos WHERE empresa_id = @empresa_id) AS vehiculos_NO_se_borran,
  (SELECT COUNT(*) FROM tms_planes_viaje WHERE empresa_id = @empresa_id) AS planes_tms_NO_se_borran;

-- Si empresa_id es NULL, DETENTE.

START TRANSACTION;

UPDATE flota_viajes
SET empleado_id = NULL
WHERE empresa_id = @empresa_id AND empleado_id IS NOT NULL;

-- Evidencias de incidencias
DELETE ei FROM evidencias_incidencias ei
INNER JOIN incidencias i ON i.id = ei.incidencia_id
WHERE i.empresa_id = @empresa_id;

DELETE FROM evidencias_incidencias WHERE empresa_id = @empresa_id;

DELETE FROM documentos_empleados WHERE empresa_id = @empresa_id;

-- detalle_consumo_vacaciones usa incidencia_id + saldo_id (NO vacacion_id)
DELETE d FROM detalle_consumo_vacaciones d
INNER JOIN incidencias i ON i.id = d.incidencia_id
WHERE i.empresa_id = @empresa_id;

DELETE d FROM detalle_consumo_vacaciones d
INNER JOIN saldos_vacaciones s ON s.id = d.saldo_id
WHERE s.empresa_id = @empresa_id;

-- Si en tu BD la tabla se llama en singular, descomenta:
-- DELETE d FROM detalle_consumo_vacacion d
-- INNER JOIN incidencias i ON i.id = d.incidencia_id
-- WHERE i.empresa_id = @empresa_id;

DELETE FROM vacaciones WHERE empresa_id = @empresa_id;
DELETE FROM saldos_vacaciones WHERE empresa_id = @empresa_id;
DELETE FROM marcajes_en_ruta WHERE empresa_id = @empresa_id;
DELETE FROM incidencias WHERE empresa_id = @empresa_id;
DELETE FROM sesiones_trabajo WHERE empresa_id = @empresa_id;

DELETE FROM rrhh_descuentos WHERE empresa_id = @empresa_id;
DELETE FROM rrhh_prestaciones WHERE empresa_id = @empresa_id;
DELETE FROM rrhh_planilla_periodos WHERE empresa_id = @empresa_id;
DELETE FROM inventario_rrhh WHERE empresa_id = @empresa_id;

DELETE FROM empleados WHERE empresa_id = @empresa_id;

SELECT
  (SELECT COUNT(*) FROM empleados WHERE empresa_id = @empresa_id) AS empleados_restantes,
  (SELECT COUNT(*) FROM sesiones_trabajo WHERE empresa_id = @empresa_id) AS marcajes_restantes,
  (SELECT COUNT(*) FROM flota_vehiculos WHERE empresa_id = @empresa_id) AS vehiculos_ok,
  (SELECT COUNT(*) FROM tms_planes_viaje WHERE empresa_id = @empresa_id) AS planes_tms_ok;

COMMIT;
-- Si algo falló: ROLLBACK;

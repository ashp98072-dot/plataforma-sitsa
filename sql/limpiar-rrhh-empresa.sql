-- =============================================================================
-- Vaciar SOLO datos de RRHH de una empresa (ej. KT / Kuiqtrans)
-- NO toca: Operaciones (TMS), Flota/Predios, Contabilidad, CMS, Usuarios
-- =============================================================================
-- USO:
--   1) Revisa el SELECT de verificación.
--   2) Cambia @codigo_empresa si no es 'KT'.
--   3) Ejecuta el bloque DELETE dentro de una transacción.
-- =============================================================================

SET @codigo_empresa = 'KT';  -- Cambiar a FRANCISCO, etc. si aplica

SELECT id, codigo, nombre, slug
INTO @empresa_id, @c, @n, @s
FROM empresas
WHERE codigo = @codigo_empresa
LIMIT 1;

SELECT
  @empresa_id AS empresa_id,
  @c AS codigo,
  @n AS nombre,
  (SELECT COUNT(*) FROM empleados WHERE empresa_id = @empresa_id) AS empleados,
  (SELECT COUNT(*) FROM sesiones_trabajo WHERE empresa_id = @empresa_id) AS marcajes,
  (SELECT COUNT(*) FROM flota_vehiculos WHERE empresa_id = @empresa_id) AS vehiculos_NO_se_borran,
  (SELECT COUNT(*) FROM tms_planes_viaje WHERE empresa_id = @empresa_id) AS planes_tms_NO_se_borran;

-- Si empresa_id es NULL, DETENTE. No ejecutes los DELETE.

START TRANSACTION;

-- Quitar solo la referencia a empleado en viajes (no borra el viaje)
UPDATE flota_viajes
SET empleado_id = NULL
WHERE empresa_id = @empresa_id AND empleado_id IS NOT NULL;

-- ----- Hijos / evidencias RRHH -----
DELETE ei FROM evidencias_incidencias ei
INNER JOIN incidencias i ON i.id = ei.incidencia_id
WHERE i.empresa_id = @empresa_id;

DELETE FROM evidencias_incidencias WHERE empresa_id = @empresa_id;

-- Evidencias de vacaciones (solo si existe esa tabla; si falla, comenta estas 3 líneas)
-- DELETE ev FROM vacacion_evidencias ev
-- INNER JOIN vacaciones v ON v.id = ev.vacacion_id
-- WHERE v.empresa_id = @empresa_id;

DELETE FROM documentos_empleados WHERE empresa_id = @empresa_id;

DELETE d FROM detalle_consumo_vacaciones d
INNER JOIN vacaciones v ON v.id = d.vacacion_id
WHERE v.empresa_id = @empresa_id;

DELETE FROM vacaciones WHERE empresa_id = @empresa_id;
DELETE FROM saldos_vacaciones WHERE empresa_id = @empresa_id;
DELETE FROM marcajes_en_ruta WHERE empresa_id = @empresa_id;
DELETE FROM incidencias WHERE empresa_id = @empresa_id;
DELETE FROM sesiones_trabajo WHERE empresa_id = @empresa_id;

DELETE FROM rrhh_descuentos WHERE empresa_id = @empresa_id;
DELETE FROM rrhh_prestaciones WHERE empresa_id = @empresa_id;
DELETE FROM rrhh_planilla_periodos WHERE empresa_id = @empresa_id;

DELETE FROM inventario_rrhh WHERE empresa_id = @empresa_id;

-- Feriados y config RRHH de esa empresa (opcional; comenta si quieres conservarlos)
-- DELETE FROM feriados WHERE empresa_id = @empresa_id;
-- DELETE FROM configuracion WHERE empresa_id = @empresa_id;

-- Empleados al final
DELETE FROM empleados WHERE empresa_id = @empresa_id;

-- Verificación final
SELECT
  (SELECT COUNT(*) FROM empleados WHERE empresa_id = @empresa_id) AS empleados_restantes,
  (SELECT COUNT(*) FROM sesiones_trabajo WHERE empresa_id = @empresa_id) AS marcajes_restantes,
  (SELECT COUNT(*) FROM flota_vehiculos WHERE empresa_id = @empresa_id) AS vehiculos_ok,
  (SELECT COUNT(*) FROM tms_planes_viaje WHERE empresa_id = @empresa_id) AS planes_tms_ok;

-- Si todo se ve bien:
COMMIT;
-- Si algo falló:
-- ROLLBACK;

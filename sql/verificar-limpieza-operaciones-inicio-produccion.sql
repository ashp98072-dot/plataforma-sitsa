-- LIMPIEZA-OPERACIONES-INICIO-PRODUCCION-1 / VERIFICACIÓN POSTERIOR (SOLO LECTURA)
SET @empresa_id_objetivo := NULL;
SET @codigo_empresa_objetivo := 'REEMPLAZAR';
SELECT COUNT(*) INTO @empresa_confirmada FROM empresas WHERE id=@empresa_id_objetivo AND codigo=@codigo_empresa_objetivo;
SELECT IF(@empresa_confirmada=1, 'OK', 'DETENER: id/codigo no coinciden') control_destino;

-- Todos deben ser 0.
SELECT 'tms_planes_viaje' tabla, COUNT(*) restantes FROM tms_planes_viaje WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_plan_paradas', COUNT(*) FROM tms_plan_paradas x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_plan_auxiliares', COUNT(*) FROM tms_plan_auxiliares x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_evidencias', COUNT(*) FROM tms_evidencias WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_viaticos', COUNT(*) FROM tms_viaticos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_viajes ligados', COUNT(*) FROM flota_viajes v JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_gastos_operativos', COUNT(*) FROM tms_gastos_operativos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_fondo', COUNT(*) FROM tms_solicitudes_fondo WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_cliente', COUNT(*) FROM tms_solicitudes_cliente WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cotizaciones', COUNT(*) FROM tms_cotizaciones WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_factura_viajes ligados a planes de la empresa', COUNT(*) FROM fact_factura_viajes ffv JOIN tms_planes_viaje p ON p.id=ffv.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo;

-- Repetir los conteos maestros y compararlos exactamente con el resultado guardado del PREVIEW.
SELECT 'tms_clientes' tabla, COUNT(*) cantidad FROM tms_clientes WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_contactos', COUNT(*) FROM tms_cliente_contactos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ubicaciones', COUNT(*) FROM tms_cliente_ubicaciones WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_rutas', COUNT(*) FROM tms_cliente_rutas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ruta_paradas', COUNT(*) FROM tms_cliente_ruta_paradas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ruta_personal', COUNT(*) FROM tms_cliente_ruta_personal WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ruta_tarifas', COUNT(*) FROM tms_cliente_ruta_tarifas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_usuarios', COUNT(*) FROM tms_cliente_usuarios WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'empleados', COUNT(*) FROM empleados WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_vehiculos', COUNT(*) FROM flota_vehiculos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'usuarios (global; control de no modificación)', COUNT(*) FROM usuarios WHERE @empresa_confirmada=1
UNION ALL SELECT 'usuario_empresa', COUNT(*) FROM usuario_empresa WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'usuario_firmas (global; control de no modificación)', COUNT(*) FROM usuario_firmas WHERE @empresa_confirmada=1;

-- Huérfanos relevantes: todos deben ser 0.
SELECT 'tms_plan_paradas sin plan' comprobacion, COUNT(*) huerfanos FROM tms_plan_paradas x LEFT JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE p.id IS NULL
UNION ALL SELECT 'tms_plan_auxiliares sin plan', COUNT(*) FROM tms_plan_auxiliares x LEFT JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE p.id IS NULL
UNION ALL SELECT 'tms_evidencias sin plan', COUNT(*) FROM tms_evidencias x LEFT JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE x.empresa_id=@empresa_id_objetivo AND p.id IS NULL
UNION ALL SELECT 'fondo_lineas sin solicitud', COUNT(*) FROM tms_solicitud_fondo_lineas x LEFT JOIN tms_solicitudes_fondo s ON s.id=x.solicitud_id WHERE s.id IS NULL
UNION ALL SELECT 'solicitud_paradas sin solicitud', COUNT(*) FROM tms_solicitud_paradas x LEFT JOIN tms_solicitudes_cliente s ON s.id=x.solicitud_id WHERE s.id IS NULL;

-- Revisión global de integridad InnoDB (diagnóstico; no modifica datos).
SELECT TABLE_NAME, CONSTRAINT_NAME
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, CONSTRAINT_NAME;

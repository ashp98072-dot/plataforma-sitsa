-- LIMPIEZA-OPERACIONES-INICIO-PRODUCCION-1 / PREVIEW (SOLO LECTURA)
-- MariaDB. No modifica datos ni archivos.
-- Complete AMBOS valores. Si no coinciden exactamente con empresas, todos los conteos objetivo serán 0.
SET @empresa_id_objetivo := NULL;
SET @codigo_empresa_objetivo := 'REEMPLAZAR';

SELECT COUNT(*) INTO @empresa_confirmada
FROM empresas
WHERE id = @empresa_id_objetivo
  AND codigo = @codigo_empresa_objetivo;

SELECT
  @empresa_id_objetivo AS empresa_id,
  @codigo_empresa_objetivo AS codigo_confirmado,
  IF(@empresa_confirmada = 1, 'OK: empresa confirmada', 'DETENER: id/codigo no coinciden') AS control_destino;

-- Bloqueo deliberado: la limpieza no está autorizada para borrar facturación.
SELECT COUNT(*) INTO @bloqueos_facturacion
FROM fact_factura_viajes ffv
JOIN tms_planes_viaje p ON p.id = ffv.plan_id
WHERE @empresa_confirmada = 1
  AND p.empresa_id = @empresa_id_objetivo;

SELECT @bloqueos_facturacion AS viajes_vinculados_a_facturacion,
       IF(@bloqueos_facturacion = 0, 'OK', 'DETENER: resolver facturación antes de limpiar') AS estado;

-- TRANSACCIONAL / DEPENDIENTE: registros que eliminará el script de limpieza.
SELECT 'tms_planes_viaje' tabla, COUNT(*) cantidad FROM tms_planes_viaje WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_plan_paradas', COUNT(*) FROM tms_plan_paradas x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_plan_auxiliares', COUNT(*) FROM tms_plan_auxiliares x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_evidencias', COUNT(*) FROM tms_evidencias WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_viaticos', COUNT(*) FROM tms_viaticos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_viajes (ligados a planes)', COUNT(*) FROM flota_viajes v JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_viaje_evidencias (ligadas)', COUNT(*) FROM flota_viaje_evidencias e JOIN flota_viajes v ON v.id=e.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_lecturas (ligadas)', COUNT(*) FROM flota_lecturas l JOIN flota_viajes v ON v.id=l.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_lectura_evidencias (ligadas)', COUNT(*) FROM flota_lectura_evidencias e JOIN flota_lecturas l ON l.id=e.lectura_id JOIN flota_viajes v ON v.id=l.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_combustible_cargas (ligadas)', COUNT(*) FROM flota_combustible_cargas c JOIN flota_viajes v ON v.id=c.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_combustible_conciliacion_filas (ligadas)', COUNT(*) FROM flota_combustible_conciliacion_filas f JOIN flota_combustible_cargas c ON c.id=f.carga_combustible_id JOIN flota_viajes v ON v.id=c.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_gastos_operativos', COUNT(*) FROM tms_gastos_operativos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_fondo', COUNT(*) FROM tms_solicitudes_fondo WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitud_fondo_lineas', COUNT(*) FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.id=l.solicitud_id WHERE @empresa_confirmada=1 AND s.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_cliente', COUNT(*) FROM tms_solicitudes_cliente WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitud_paradas', COUNT(*) FROM tms_solicitud_paradas sp JOIN tms_solicitudes_cliente s ON s.id=sp.solicitud_id WHERE @empresa_confirmada=1 AND s.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cotizaciones', COUNT(*) FROM tms_cotizaciones WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'firmas_electronicas (solo fondos/viáticos objetivo)', COUNT(*) FROM firmas_electronicas f WHERE @empresa_confirmada=1 AND f.empresa_id=@empresa_id_objetivo AND ((f.modulo='VIATICOS' AND f.entidad_tipo='VIATICO' AND EXISTS (SELECT 1 FROM tms_viaticos v WHERE v.id=f.entidad_id AND v.empresa_id=@empresa_id_objetivo)) OR (f.modulo='FONDOS' AND f.entidad_tipo='SOLICITUD_FONDO' AND EXISTS (SELECT 1 FROM tms_solicitudes_fondo s WHERE s.id=f.entidad_id AND s.empresa_id=@empresa_id_objetivo)));

-- MAESTROS: guardar estos conteos; deben coincidir exactamente después de la limpieza.
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

-- DUDOSO / NO TOCAR: no existe relación inequívoca con un plan de viaje.
SELECT 'ops_multas' tabla, COUNT(*) cantidad, 'PRESERVAR: sin FK inequívoca a viaje' razon FROM ops_multas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'ops_multas_revisiones', COUNT(*), 'PRESERVAR con su multa' FROM ops_multas_revisiones r JOIN ops_multas m ON m.id=r.multa_id WHERE @empresa_confirmada=1 AND m.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'ops_multa_documentos', COUNT(*), 'PRESERVAR con su multa' FROM ops_multa_documentos d JOIN ops_multas m ON m.id=d.multa_id WHERE @empresa_confirmada=1 AND m.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_factura_viajes', COUNT(*), 'BLOQUEA toda la limpieza; facturación no autorizada' FROM fact_factura_viajes ffv JOIN tms_planes_viaje p ON p.id=ffv.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_combustible_conciliaciones', COUNT(*), 'PRESERVAR cabecera; solo se quitan filas ligadas' FROM flota_combustible_conciliaciones WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo;

-- ============================================================================
-- DATOS DE OPERACIONES QUE QUEDARÁN DESPUÉS DE LA LIMPIEZA
-- `cantidad_estimada_despues` supone que la transacción termina con COMMIT.
-- DUDOSO / REQUIERE DECISIÓN nunca se borra automáticamente.
-- ============================================================================
SELECT 'clientes' tabla, 'PRESERVAR MAESTRO' clasificacion,
       COUNT(*) cantidad_actual, COUNT(*) cantidad_estimada_despues,
       'Catálogo compartido de clientes' motivo
FROM clientes WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_clientes', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Cliente maestro TMS' FROM tms_clientes WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_contactos', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Contactos reales' FROM tms_cliente_contactos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ubicaciones', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Ubicaciones reales' FROM tms_cliente_ubicaciones WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_usuarios', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Accesos de clientes' FROM tms_cliente_usuarios WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_rutas', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Rutas reales' FROM tms_cliente_rutas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ruta_paradas', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Paradas predeterminadas' FROM tms_cliente_ruta_paradas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ruta_personal', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Personal habitual' FROM tms_cliente_ruta_personal WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cliente_ruta_tarifas', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Historial y tarifario' FROM tms_cliente_ruta_tarifas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_personal', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Puente operativo hacia RRHH' FROM tms_personal WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_unidades', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Puente operativo hacia flota maestra' FROM tms_unidades WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_lugares', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Catálogo operativo' FROM tms_lugares WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_viaticos_config', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Configuración de montos' FROM tms_viaticos_config WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_empresa_perfil', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Configuración de facturación de empresa' FROM fact_empresa_perfil WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_cliente_perfil', 'PRESERVAR MAESTRO', COUNT(*), COUNT(*), 'Configuración de facturación por cliente' FROM fact_cliente_perfil WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo

UNION ALL SELECT 'tms_planes_viaje', 'ELIMINAR', COUNT(*), 0, 'Programación en cualquier estado' FROM tms_planes_viaje WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_plan_paradas', 'ELIMINAR', COUNT(*), 0, 'Dependencia de planes' FROM tms_plan_paradas x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_plan_auxiliares', 'ELIMINAR', COUNT(*), 0, 'Dependencia de planes' FROM tms_plan_auxiliares x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_evidencias', 'ELIMINAR', COUNT(*), 0, 'Evidencia transaccional' FROM tms_evidencias WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_viaticos', 'ELIMINAR', COUNT(*), 0, 'Viático transaccional' FROM tms_viaticos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_gastos_operativos', 'ELIMINAR', COUNT(*), 0, 'Gastos de prueba' FROM tms_gastos_operativos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_fondo', 'ELIMINAR', COUNT(*), 0, 'Solicitudes de prueba' FROM tms_solicitudes_fondo WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitud_fondo_lineas', 'ELIMINAR', COUNT(*), 0, 'Líneas dependientes de solicitudes' FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.id=l.solicitud_id WHERE @empresa_confirmada=1 AND s.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_cliente', 'ELIMINAR', COUNT(*), 0, 'Solicitudes transaccionales del portal' FROM tms_solicitudes_cliente WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitud_paradas', 'ELIMINAR', COUNT(*), 0, 'Paradas dependientes de solicitudes' FROM tms_solicitud_paradas sp JOIN tms_solicitudes_cliente s ON s.id=sp.solicitud_id WHERE @empresa_confirmada=1 AND s.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cotizaciones', 'ELIMINAR', COUNT(*), 0, 'Cotizaciones de prueba' FROM tms_cotizaciones WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_viajes ligados', 'ELIMINAR', COUNT(*), 0, 'Ejecución ligada a planes objetivo' FROM flota_viajes v JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_viaje_evidencias ligadas', 'ELIMINAR', COUNT(*), 0, 'Evidencia de ejecución ligada' FROM flota_viaje_evidencias e JOIN flota_viajes v ON v.id=e.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_lecturas ligadas', 'ELIMINAR', COUNT(*), 0, 'Lecturas de salida/llegada ligadas' FROM flota_lecturas l JOIN flota_viajes v ON v.id=l.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_lectura_evidencias ligadas', 'ELIMINAR', COUNT(*), 0, 'Archivos de lecturas ligadas' FROM flota_lectura_evidencias e JOIN flota_lecturas l ON l.id=e.lectura_id JOIN flota_viajes v ON v.id=l.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_combustible_cargas ligadas', 'ELIMINAR', COUNT(*), 0, 'Cargas de combustible ligadas' FROM flota_combustible_cargas c JOIN flota_viajes v ON v.id=c.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_combustible_conciliacion_filas ligadas', 'ELIMINAR', COUNT(*), 0, 'Filas ligadas a cargas objetivo' FROM flota_combustible_conciliacion_filas f JOIN flota_combustible_cargas c ON c.id=f.carga_combustible_id JOIN flota_viajes v ON v.id=c.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'firmas_electronicas fondos/viáticos', 'ELIMINAR', COUNT(*), 0, 'Solo firmas transaccionales de padres eliminados' FROM firmas_electronicas f WHERE @empresa_confirmada=1 AND f.empresa_id=@empresa_id_objetivo AND ((f.modulo='VIATICOS' AND f.entidad_tipo='VIATICO' AND EXISTS (SELECT 1 FROM tms_viaticos v WHERE v.id=f.entidad_id AND v.empresa_id=@empresa_id_objetivo)) OR (f.modulo='FONDOS' AND f.entidad_tipo='SOLICITUD_FONDO' AND EXISTS (SELECT 1 FROM tms_solicitudes_fondo s WHERE s.id=f.entidad_id AND s.empresa_id=@empresa_id_objetivo)))

UNION ALL SELECT 'ops_multas', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Sin FK inequívoca a viaje; NO DELETE' FROM ops_multas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'ops_multas_revisiones', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Historial ligado a multas preservadas; NO DELETE' FROM ops_multas_revisiones r JOIN ops_multas m ON m.id=r.multa_id WHERE @empresa_confirmada=1 AND m.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'ops_multa_documentos', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Documentos ligados a multas preservadas; NO DELETE' FROM ops_multa_documentos d JOIN ops_multas m ON m.id=d.multa_id WHERE @empresa_confirmada=1 AND m.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'proveedor_portales', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Credenciales/accesos; podrían ser maestros reales o pruebas; NO DELETE' FROM proveedor_portales WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_facturas', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Documento financiero; política actual no autoriza borrarlo' FROM fact_facturas WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_pagos', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Movimiento financiero; política actual no autoriza borrarlo' FROM fact_pagos WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_factura_viajes', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Los ligados a planes objetivo BLOQUEAN toda la limpieza' FROM fact_factura_viajes ffv JOIN fact_facturas f ON f.id=ffv.factura_id WHERE @empresa_confirmada=1 AND f.empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'flota_combustible_conciliaciones', 'DUDOSO / REQUIERE DECISIÓN', COUNT(*), COUNT(*), 'Cabecera histórica sin dependencia exclusiva; NO DELETE' FROM flota_combustible_conciliaciones WHERE @empresa_confirmada=1 AND empresa_id=@empresa_id_objetivo
ORDER BY clasificacion, tabla;

-- MANIFIESTO DE ARCHIVOS. Exportar este resultado antes de ejecutar la limpieza.
-- Las rutas se borran físicamente SOLO después del COMMIT, usando la validación por empresa de src/lib/admin/limpiar-archivos.ts.
SELECT DISTINCT fuente, registro_id, ruta_archivo
FROM (
  SELECT 'tms_evidencias' fuente, e.id registro_id, e.ruta_archivo
  FROM tms_evidencias e WHERE @empresa_confirmada=1 AND e.empresa_id=@empresa_id_objetivo AND e.ruta_archivo IS NOT NULL
  UNION ALL
  SELECT 'flota_viaje_evidencias', e.id, e.ruta_relativa FROM flota_viaje_evidencias e JOIN flota_viajes v ON v.id=e.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo AND e.ruta_relativa IS NOT NULL
  UNION ALL
  SELECT 'flota_lectura_evidencias', e.id, e.ruta_relativa FROM flota_lectura_evidencias e JOIN flota_lecturas l ON l.id=e.lectura_id JOIN flota_viajes v ON v.id=l.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo AND e.ruta_relativa IS NOT NULL
  UNION ALL
  SELECT 'flota_combustible_cargas', c.id, c.ruta_relativa FROM flota_combustible_cargas c JOIN flota_viajes v ON v.id=c.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND p.empresa_id=@empresa_id_objetivo AND c.ruta_relativa IS NOT NULL
  UNION ALL
  SELECT 'firmas_electronicas', f.id, f.imagen_ruta FROM firmas_electronicas f WHERE @empresa_confirmada=1 AND f.empresa_id=@empresa_id_objetivo AND f.imagen_ruta IS NOT NULL AND ((f.modulo='VIATICOS' AND f.entidad_tipo='VIATICO' AND EXISTS (SELECT 1 FROM tms_viaticos v WHERE v.id=f.entidad_id AND v.empresa_id=@empresa_id_objetivo)) OR (f.modulo='FONDOS' AND f.entidad_tipo='SOLICITUD_FONDO' AND EXISTS (SELECT 1 FROM tms_solicitudes_fondo s WHERE s.id=f.entidad_id AND s.empresa_id=@empresa_id_objetivo)))
) archivos
ORDER BY fuente, registro_id;

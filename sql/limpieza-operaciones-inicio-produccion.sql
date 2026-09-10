-- LIMPIEZA-OPERACIONES-INICIO-PRODUCCION-1 / LIMPIEZA MANUAL
-- Requisitos: respaldo, PREVIEW revisado, manifiesto de archivos exportado y capturas detenidas.
-- NO borra archivos físicos. Solo quita vínculos de facturas Borrador sin pagos.
-- NO ejecutar si el PREVIEW informa vínculos bloqueantes de facturación.
SET @empresa_id_objetivo := NULL;
SET @codigo_empresa_objetivo := 'REEMPLAZAR';

SELECT COUNT(*) INTO @empresa_confirmada FROM empresas
WHERE id=@empresa_id_objetivo AND codigo=@codigo_empresa_objetivo;
SELECT COUNT(*) INTO @bloqueos_facturacion
FROM fact_factura_viajes ffv
JOIN tms_planes_viaje p ON p.id=ffv.plan_id
JOIN fact_facturas f ON f.id=ffv.factura_id
WHERE @empresa_confirmada=1
  AND p.empresa_id=@empresa_id_objetivo
  AND (f.empresa_id <> @empresa_id_objetivo
    OR f.estado_admin <> 'Borrador'
    OR EXISTS (SELECT 1 FROM fact_pagos pg WHERE pg.factura_id=f.id));

SELECT IF(@empresa_confirmada=1 AND @bloqueos_facturacion=0,
  'LISTO: puede iniciar la transacción',
  'DETENER: empresa inválida o existe factura emitida, anulada, pagada o fuera de la empresa') AS control_previo;

START TRANSACTION;

-- Libera únicamente planes vinculados a borradores sin pagos de la MISMA empresa.
-- No borra ni actualiza fact_facturas ni fact_pagos.
DELETE ffv FROM fact_factura_viajes ffv
JOIN tms_planes_viaje p ON p.id=ffv.plan_id
JOIN fact_facturas f ON f.id=ffv.factura_id
WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0
  AND p.empresa_id=@empresa_id_objetivo
  AND f.empresa_id=@empresa_id_objetivo
  AND f.estado_admin='Borrador'
  AND NOT EXISTS (SELECT 1 FROM fact_pagos pg WHERE pg.factura_id=f.id);

-- Firmas transaccionales: solo las asociadas a fondos/viáticos que se eliminarán.
DELETE f FROM firmas_electronicas f
WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0
  AND f.empresa_id=@empresa_id_objetivo
  AND ((f.modulo='VIATICOS' AND f.entidad_tipo='VIATICO' AND EXISTS (SELECT 1 FROM tms_viaticos v WHERE v.id=f.entidad_id AND v.empresa_id=@empresa_id_objetivo))
    OR (f.modulo='FONDOS' AND f.entidad_tipo='SOLICITUD_FONDO' AND EXISTS (SELECT 1 FROM tms_solicitudes_fondo s WHERE s.id=f.entidad_id AND s.empresa_id=@empresa_id_objetivo)));

DELETE e FROM flota_lectura_evidencias e JOIN flota_lecturas l ON l.id=e.lectura_id JOIN flota_viajes v ON v.id=l.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;
DELETE e FROM flota_viaje_evidencias e JOIN flota_viajes v ON v.id=e.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;
DELETE f FROM flota_combustible_conciliacion_filas f JOIN flota_combustible_cargas c ON c.id=f.carga_combustible_id JOIN flota_viajes v ON v.id=c.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;
DELETE c FROM flota_combustible_cargas c JOIN flota_viajes v ON v.id=c.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;
DELETE l FROM flota_lecturas l JOIN flota_viajes v ON v.id=l.viaje_id JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;

DELETE FROM tms_evidencias WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND empresa_id=@empresa_id_objetivo;
DELETE l FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.id=l.solicitud_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND s.empresa_id=@empresa_id_objetivo;
DELETE FROM tms_solicitudes_fondo WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND empresa_id=@empresa_id_objetivo;
DELETE FROM tms_gastos_operativos WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND empresa_id=@empresa_id_objetivo;
DELETE FROM tms_cotizaciones WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND empresa_id=@empresa_id_objetivo;
DELETE sp FROM tms_solicitud_paradas sp JOIN tms_solicitudes_cliente s ON s.id=sp.solicitud_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND s.empresa_id=@empresa_id_objetivo;
DELETE FROM tms_solicitudes_cliente WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND empresa_id=@empresa_id_objetivo;
DELETE FROM tms_viaticos WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND empresa_id=@empresa_id_objetivo;
DELETE x FROM tms_plan_auxiliares x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;
DELETE x FROM tms_plan_paradas x JOIN tms_planes_viaje p ON p.id=x.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;
DELETE v FROM flota_viajes v JOIN tms_planes_viaje p ON p.id=v.plan_id WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND p.empresa_id=@empresa_id_objetivo;
DELETE FROM tms_planes_viaje WHERE @empresa_confirmada=1 AND @bloqueos_facturacion=0 AND empresa_id=@empresa_id_objetivo;

-- Debe devolver cero en todas las filas antes de confirmar.
SELECT 'tms_planes_viaje' tabla, COUNT(*) restantes FROM tms_planes_viaje WHERE empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_evidencias', COUNT(*) FROM tms_evidencias WHERE empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_viaticos', COUNT(*) FROM tms_viaticos WHERE empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_gastos_operativos', COUNT(*) FROM tms_gastos_operativos WHERE empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_fondo', COUNT(*) FROM tms_solicitudes_fondo WHERE empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_solicitudes_cliente', COUNT(*) FROM tms_solicitudes_cliente WHERE empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'tms_cotizaciones', COUNT(*) FROM tms_cotizaciones WHERE empresa_id=@empresa_id_objetivo
UNION ALL SELECT 'fact_factura_viajes ligados a planes de la empresa', COUNT(*) FROM fact_factura_viajes ffv JOIN tms_planes_viaje p ON p.id=ffv.plan_id WHERE p.empresa_id=@empresa_id_objetivo;

-- Revise el resultado anterior. Ejecute UNA sola opción manualmente:
-- COMMIT;
-- ROLLBACK;

-- Después de COMMIT: borre únicamente las rutas del manifiesto mediante
-- src/lib/admin/limpiar-archivos.ts (borrarArchivosFisicos), que valida empresa, raíz y symlinks.

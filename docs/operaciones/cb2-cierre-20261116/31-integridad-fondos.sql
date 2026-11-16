-- SOLO SELECT/SHOW. Seleccionar y verificar manualmente la base destino. Ejecutar por separado.
-- Metadata puede no ser visible sin permisos; ausencia no es certificacion.
SELECT v.consumo_id FROM `flota_cb2_fondos_vinculos` v
 LEFT JOIN `flota_cb2_consumos` c ON c.empresa_id=v.empresa_id AND c.proveedor_id=v.proveedor_id AND c.id=v.consumo_id
 LEFT JOIN `tms_solicitud_fondo_lineas` l ON l.empresa_id=v.empresa_id AND l.id=v.linea_id
 WHERE c.id IS NULL OR l.id IS NULL;

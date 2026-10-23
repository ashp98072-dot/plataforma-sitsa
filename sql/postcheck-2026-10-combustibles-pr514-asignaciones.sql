-- SOLO PREPARADO. Ejecutar después de DDL aprobado, antes de habilitar escrituras de aplicación.
SHOW CREATE TABLE flota_cb2_consumos;
SHOW CREATE TABLE flota_cb2_asignaciones;
SELECT COUNT(*) AS columnas_nuevas_deben_ser_3 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('empleado_id','producto_clasificado','revision_asignacion');
SELECT COUNT(*) AS consumos_despues,MIN(id) AS primer_id,MAX(id) AS ultimo_id FROM flota_cb2_consumos;
SELECT COUNT(*) AS metadatos_deben_ser_0_antes_de_habilitar_app FROM flota_cb2_consumos WHERE empleado_id IS NOT NULL OR producto_clasificado IS NOT NULL OR revision_asignacion<>0;
SELECT COUNT(*) AS empleados_fuera_empresa_debe_ser_0 FROM flota_cb2_consumos c JOIN empleados e ON e.id=c.empleado_id WHERE e.empresa_id<>c.empresa_id;
SELECT COUNT(*) AS asignaciones_fuera_empresa_debe_ser_0 FROM flota_cb2_asignaciones a JOIN flota_cb2_consumos c ON c.id=a.consumo_id WHERE a.empresa_id<>c.empresa_id OR a.proveedor_id<>c.proveedor_id;
SELECT COUNT(*) AS asignaciones_deben_ser_0_antes_de_habilitar_app FROM flota_cb2_asignaciones;
-- Comparar con preflight y backup. Confirmar FK, CHECK, índices y tipos completos en SHOW CREATE.
-- Si hay diferencias o aplicación parcial: mantener aplicación retirada y revisar. No repetir DDL a ciegas.

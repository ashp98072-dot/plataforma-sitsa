-- SOLO SELECT. Inmediatamente despues de instalar, ambas cantidades deben ser cero.
SELECT COUNT(*) nombres_reportados FROM flota_cb2_pilotos_reportados;
SELECT COUNT(*) vinculos FROM flota_cb2_consumo_piloto_reportado;
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias');
SELECT TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias');
SELECT TABLE_NAME,CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS
 WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('flota_cb2_pilotos_reportados','flota_cb2_pilotos_equivalencias');
-- Cero filas: ningun nombre se declara persona definitiva ni se vincula a un consumo ajeno.
SELECT id FROM flota_cb2_pilotos_reportados WHERE estado<>'REPORTADO_CONFIRMADO';
SELECT v.consumo_id FROM flota_cb2_consumo_piloto_reportado v
 LEFT JOIN flota_cb2_consumos c ON c.empresa_id=v.empresa_id AND c.proveedor_id=v.proveedor_id AND c.id=v.consumo_id
 LEFT JOIN flota_cb2_pilotos_reportados p ON p.empresa_id=v.empresa_id AND p.id=v.piloto_reportado_id
 WHERE c.id IS NULL OR p.id IS NULL;

SELECT COUNT(*) equivalencias_confirmadas FROM flota_cb2_pilotos_equivalencias;
-- Cero filas: ámbitos y destinos de equivalencias válidos.
SELECT x.nombre_hash FROM flota_cb2_pilotos_equivalencias x LEFT JOIN empleados e ON e.id=x.empleado_id AND e.empresa_id=x.empresa_id LEFT JOIN flota_cb2_pilotos_reportados p ON p.id=x.piloto_reportado_id AND p.empresa_id=x.empresa_id WHERE (x.empleado_id IS NOT NULL AND e.id IS NULL) OR (x.piloto_reportado_id IS NOT NULL AND p.id IS NULL);

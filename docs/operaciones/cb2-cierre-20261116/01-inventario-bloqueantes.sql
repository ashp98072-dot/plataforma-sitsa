-- SOLO LECTURA. No acredita instalación correcta: contrastar cuerpos y preflight correspondiente.
SELECT DATABASE() AS base,VERSION() AS version,@@foreign_key_checks AS fk,@@check_constraint_checks AS ck;
SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME IN ('flota_cb2_externos_pilotos','flota_cb2_externos_unidades','flota_cb2_externos_asociaciones',
 'flota_cb2_pilotos_reportados','flota_cb2_consumo_piloto_reportado','flota_cb2_pilotos_equivalencias',
 'flota_cb2_fondos_vinculos','flota_vehiculos_fusiones','flota_identidades_fisicas') ORDER BY TABLE_NAME;
SELECT COLUMN_NAME,COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
 AND TABLE_NAME='flota_cb2_consumos' AND COLUMN_NAME IN ('piloto_externo_id','unidad_externa_id','asociacion_externa_id','identidad_externa','revision_asignacion');
SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()
 AND TABLE_NAME='flota_cb2_consumos' ORDER BY CONSTRAINT_NAME;
SELECT EVENT_OBJECT_TABLE,TRIGGER_NAME,ACTION_ORDER,ACTION_STATEMENT FROM information_schema.TRIGGERS
 WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY EVENT_OBJECT_TABLE,TRIGGER_NAME;

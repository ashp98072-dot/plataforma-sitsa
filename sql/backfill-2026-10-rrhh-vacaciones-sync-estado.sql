-- PROPUESTA SEPARADA, NO EJECUTADA. Ejecutar únicamente con autorización futura.
-- READ-BASED conservador: lee empleados, escribe solo índice de frescura.
-- No hay evidencia suficiente para marcar saldos actuales como frescos sin evaluar el motor.
-- NO evita la primera pasada; su uso es OPCIONAL. Todos quedan dirty para validación serial.
INSERT IGNORE INTO u611730801_Plataforma.rrhh_vacaciones_sync_estado (empresa_id, id_empleado)
SELECT empresa_id, id FROM u611730801_Plataforma.empleados
WHERE estado = 'Activo' AND fecha_alta IS NOT NULL;

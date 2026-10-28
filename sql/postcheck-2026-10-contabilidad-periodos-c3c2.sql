-- Solo lectura, para la instalación NUEVA aislada; no acredita compatibilidad operativa.
SELECT 'tablas' control, 6-COUNT(*) errores FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN('cont_control_libro','cont_periodos_operadores','cont_control_diagnosticos','cont_periodos_solicitudes','cont_periodos_historial','cont_periodos_cierres') AND ENGINE='InnoDB';
SELECT 'versiones' control, COUNT(*) errores FROM cont_periodos WHERE version<>0 OR revision_cierre<>0 OR estado<>'CONFIGURADO';
SELECT 'sin_activaciones' control, COUNT(*) errores FROM cont_control_libro WHERE estado<>'NO_ACTIVADO' OR activado_en IS NOT NULL;
SELECT 'sin_operadores_auto' control, COUNT(*) errores FROM cont_periodos_operadores;
SELECT 'sin_historial_auto' control, COUNT(*) errores FROM cont_periodos_historial;

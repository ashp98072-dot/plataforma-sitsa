-- Solo lectura: requiere todas las comprobaciones en OK.
SELECT 'Tablas de traslados InnoDB' AS comprobacion,
 IF((SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND engine='InnoDB' AND table_name IN ('canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones','canecas_traslado_recepcion_partidas','canecas_traslado_documentos'))=5,'OK','DETENER') AS resultado
UNION ALL SELECT 'Guardas de inmutabilidad',
 IF((SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name IN ('can_tras_doc_no_update','can_tras_doc_no_delete') AND event_object_table='canecas_traslado_documentos')=2,'OK','DETENER')
UNION ALL SELECT 'Base seleccionada', IF(DATABASE() IS NULL,'DETENER','OK');


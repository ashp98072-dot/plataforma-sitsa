-- Diagnóstico SOLO DE LECTURA para instalación parcial. No indica que sea seguro
-- borrar objetos ni sustituye verificar backups, datos, dependencias y versión.
SELECT DATABASE() AS base_seleccionada, VERSION() AS version_motor;
SELECT t.table_name,t.table_type,t.engine,t.table_collation
FROM information_schema.tables t WHERE t.table_schema=DATABASE()
AND t.table_name IN ('canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones','canecas_traslado_recepcion_partidas','canecas_traslado_documentos') ORDER BY t.table_name;
SELECT c.table_name,c.ordinal_position,c.column_name,c.column_type,c.is_nullable,c.column_default
FROM information_schema.columns c WHERE c.table_schema=DATABASE()
AND c.table_name IN ('canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones','canecas_traslado_recepcion_partidas','canecas_traslado_documentos') ORDER BY c.table_name,c.ordinal_position;
SELECT s.table_name,s.index_name,s.non_unique,s.seq_in_index,s.column_name
FROM information_schema.statistics s WHERE s.table_schema=DATABASE()
AND s.table_name IN ('canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones','canecas_traslado_recepcion_partidas','canecas_traslado_documentos') ORDER BY s.table_name,s.index_name,s.seq_in_index;
SELECT k.table_name,k.constraint_name,k.column_name,k.referenced_table_name,k.referenced_column_name
FROM information_schema.key_column_usage k WHERE k.table_schema=DATABASE() AND k.referenced_table_name IS NOT NULL
AND k.table_name IN ('canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones','canecas_traslado_recepcion_partidas','canecas_traslado_documentos') ORDER BY k.table_name,k.constraint_name,k.ordinal_position;
SELECT trigger_name,event_object_table,action_timing,event_manipulation FROM information_schema.triggers
WHERE trigger_schema=DATABASE() AND trigger_name IN ('can_tras_doc_no_update','can_tras_doc_no_delete');
SELECT routine_name,routine_type FROM information_schema.routines WHERE routine_schema=DATABASE() AND routine_name='can_tras_rollback_vacio';

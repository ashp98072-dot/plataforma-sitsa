-- Solo lectura. Ejecutar en la base seleccionada y detenerse si alguna fila dice DETENER.
SELECT 'Base seleccionada' AS comprobacion,
  IF(DATABASE() IS NULL,'DETENER','OK') AS resultado
UNION ALL
SELECT 'Tablas Canecas y empresas requeridas en InnoDB',
  IF((SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
      AND table_name IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_movimientos') AND engine='InnoDB')=6,'OK','DETENER')
UNION ALL
SELECT 'Tablas de traslado aún no instaladas',
  IF((SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE()
      AND table_name IN ('canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones','canecas_traslado_recepcion_partidas','canecas_traslado_documentos'))=0,'OK','DETENER')
UNION ALL
SELECT 'Triggers de documento aún no instalados',
  IF((SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE()
      AND trigger_name IN ('can_tras_doc_no_update','can_tras_doc_no_delete'))=0,'OK','DETENER')
UNION ALL
SELECT 'Sin procedimiento residual de rollback',
  IF((SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema=DATABASE()
      AND routine_name='can_tras_rollback_vacio')=0,'OK','DETENER')
UNION ALL
SELECT 'Columnas clave enteras esperadas en tablas existentes',
  IF((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND data_type='int' AND is_nullable='NO'
      AND ((table_name IN ('empresas','usuarios') AND column_name='id')
        OR (table_name IN ('canecas_productos','canecas_ubicaciones') AND column_name IN ('id','empresa_id'))
        OR (table_name='canecas_saldos' AND column_name IN ('empresa_id','producto_id','ubicacion_id','fisico','reservado'))))=11,'OK','DETENER')
UNION ALL
SELECT 'Índices únicos compuestos de productos y ubicaciones',
  IF((SELECT COUNT(*) FROM (SELECT table_name,index_name FROM information_schema.statistics
      WHERE table_schema=DATABASE() AND table_name IN ('canecas_productos','canecas_ubicaciones') AND non_unique=0
      GROUP BY table_name,index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',')='empresa_id,id') indices_padre)=2,'OK','DETENER');

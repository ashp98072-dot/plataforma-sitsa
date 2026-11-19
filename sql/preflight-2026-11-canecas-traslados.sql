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
      AND trigger_name IN ('can_tras_doc_no_update','can_tras_doc_no_delete'))=0,'OK','DETENER');


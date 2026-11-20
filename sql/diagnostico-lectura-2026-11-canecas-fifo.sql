-- SOLO LECTURA. Seleccionar previamente la base en phpMyAdmin.
-- No ejecutar migración ni inferir compatibilidad solo por este diagnóstico.
-- Usar el usuario previsto para instalación: la visibilidad puede ser parcial.
SELECT DATABASE() AS base_seleccionada, VERSION() AS version_servidor,
       @@version_comment AS distribucion, CURRENT_USER() AS usuario_efectivo,
       @@sql_mode AS modo_sql, @@foreign_key_checks AS claves_foraneas_activas,
       @@character_set_server AS charset_servidor, @@collation_server AS collation_servidor,
       @@character_set_database AS charset_base, @@collation_database AS collation_base;

SELECT CASE WHEN DATABASE() IS NULL THEN 'DETENER: seleccione una base'
            WHEN VERSION() LIKE '11.8.9-MariaDB%' THEN 'VERSION ENSAYADA: comprobar los demás resultados'
            ELSE 'NO VERIFICADA: la batería y el contrato se limitaron a MariaDB 11.8.9' END AS veredicto_version;

SHOW VARIABLES WHERE Variable_name IN ('check_constraint_checks','default_storage_engine','foreign_key_checks',
  'innodb_strict_mode','lower_case_table_names','sql_mode','character_set_server','collation_server');

SELECT esperado.nombre AS tabla, t.TABLE_TYPE AS tipo, t.ENGINE AS motor,
       t.TABLE_COLLATION AS collation,
       CASE WHEN t.TABLE_NAME IS NULL THEN 'DETENER: ausente o sin visibilidad'
            WHEN t.TABLE_TYPE <> 'BASE TABLE' OR t.ENGINE <> 'InnoDB' THEN 'DETENER: tipo o motor incompatible'
            ELSE 'REVISAR' END AS resultado
FROM (SELECT 'empresas' nombre UNION ALL SELECT 'usuarios' UNION ALL SELECT 'canecas_productos'
      UNION ALL SELECT 'canecas_ubicaciones' UNION ALL SELECT 'canecas_saldos'
      UNION ALL SELECT 'canecas_compras' UNION ALL SELECT 'canecas_recepciones'
      UNION ALL SELECT 'canecas_movimientos') esperado
LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=esperado.nombre
ORDER BY esperado.nombre;

SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,CHARACTER_SET_NAME,COLLATION_NAME
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
AND TABLE_NAME IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos')
ORDER BY TABLE_NAME,ORDINAL_POSITION;

SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
AND TABLE_NAME IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos')
ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;

SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE()
AND TABLE_NAME IN ('canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos')
AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;

SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
AND TABLE_NAME IN ('canecas_valoraciones_iniciales','canecas_capas_costo','canecas_gastos_posteriores',
                   'canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones',
                   'canecas_traslado_recepcion_partidas','canecas_traslado_documentos') ORDER BY TABLE_NAME;

SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,ACTION_TIMING,EVENT_MANIPULATION
FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
AND (EVENT_OBJECT_TABLE IN ('canecas_compras','canecas_productos','canecas_recepciones','canecas_saldos','canecas_movimientos')
     OR TRIGGER_NAME IN ('can_compra_costos_inmutables','can_capa_costo_inmutable','can_capa_no_borrar','can_gasto_no_editar','can_gasto_no_borrar','can_valoracion_no_editar','can_valoracion_no_borrar'))
ORDER BY TRIGGER_NAME;

-- SHOW GRANTS es de solo lectura; su salida puede incluir nombres de usuarios y hosts.
-- Revisarla localmente y ocultar esos identificadores antes de compartirla.
SHOW GRANTS FOR CURRENT_USER;

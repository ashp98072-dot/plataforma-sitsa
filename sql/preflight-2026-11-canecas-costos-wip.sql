-- BORRADOR SOLO LECTURA. No autoriza instalación; revisar cada fila y los permisos efectivos.
SELECT DATABASE() AS base_seleccionada, VERSION() AS servidor, @@sql_mode AS sql_mode, CURRENT_USER() AS usuario_efectivo;
SELECT 'base seleccionada' AS comprobacion, IF(DATABASE() IS NULL,'DETENER','REVISAR') AS resultado
UNION ALL SELECT 'versión ensayada', IF(VERSION() LIKE '11.8.9-MariaDB%','REVISAR','DETENER')
UNION ALL SELECT 'restricciones activas', IF(@@foreign_key_checks=1 AND @@check_constraint_checks=1,'REVISAR','DETENER')
UNION ALL SELECT 'modo SQL estricto', IF(FIND_IN_SET('STRICT_TRANS_TABLES',@@sql_mode)>0 OR FIND_IN_SET('STRICT_ALL_TABLES',@@sql_mode)>0,'REVISAR','DETENER')
UNION ALL SELECT 'tablas base InnoDB', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos') AND TABLE_TYPE='BASE TABLE' AND ENGINE='InnoDB')=8,'REVISAR','DETENER')
UNION ALL SELECT 'tablas nuevas ausentes', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_valoraciones_iniciales','canecas_capas_costo','canecas_gastos_posteriores'))=0,'REVISAR','DETENER')
UNION ALL SELECT 'traslados pendientes de compatibilidad FIFO', IF((SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_traslados','canecas_traslado_partidas','canecas_traslado_recepciones','canecas_traslado_recepcion_partidas','canecas_traslado_documentos'))=0,'REVISAR','DETENER')
UNION ALL SELECT 'columnas nuevas ausentes', IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='canecas_compras' AND COLUMN_NAME IN ('precio_unitario_centavos','gastos_centavos','moneda')) OR (TABLE_NAME='canecas_productos' AND COLUMN_NAME IN ('precio_venta_referencia_centavos','precio_venta_referencia_moneda'))))=0,'REVISAR','DETENER')
UNION ALL SELECT 'triggers nuevos ausentes', IF((SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('can_compra_costos_inmutables','can_capa_costo_inmutable','can_capa_no_borrar','can_gasto_no_editar','can_gasto_no_borrar','can_valoracion_no_editar','can_valoracion_no_borrar'))=0,'REVISAR','DETENER');
SELECT e.tabla,e.columna,e.tipo,IF(c.COLUMN_NAME IS NOT NULL AND c.DATA_TYPE=e.tipo AND c.COLUMN_TYPE NOT LIKE '%unsigned%' AND c.IS_NULLABLE='NO','REVISAR','DETENER') AS resultado,c.COLUMN_TYPE,c.IS_NULLABLE
FROM (
 SELECT 'empresas' tabla,'id' columna,'int' tipo UNION ALL SELECT 'usuarios','id','int'
 UNION ALL SELECT 'canecas_productos','empresa_id','int' UNION ALL SELECT 'canecas_productos','id','int'
 UNION ALL SELECT 'canecas_ubicaciones','empresa_id','int' UNION ALL SELECT 'canecas_ubicaciones','id','int'
 UNION ALL SELECT 'canecas_compras','empresa_id','int' UNION ALL SELECT 'canecas_compras','id','int'
 UNION ALL SELECT 'canecas_compras','producto_id','int' UNION ALL SELECT 'canecas_compras','cantidad','int'
 UNION ALL SELECT 'canecas_recepciones','empresa_id','int' UNION ALL SELECT 'canecas_recepciones','id','int'
 UNION ALL SELECT 'canecas_recepciones','compra_id','int' UNION ALL SELECT 'canecas_recepciones','ubicacion_id','int' UNION ALL SELECT 'canecas_recepciones','cantidad','int'
 UNION ALL SELECT 'canecas_saldos','empresa_id','int' UNION ALL SELECT 'canecas_saldos','producto_id','int' UNION ALL SELECT 'canecas_saldos','ubicacion_id','int' UNION ALL SELECT 'canecas_saldos','fisico','int' UNION ALL SELECT 'canecas_saldos','reservado','int'
) e LEFT JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.columna ORDER BY e.tabla,e.columna;
SELECT e.tabla,e.columnas,IF(i.columnas IS NULL,'DETENER','REVISAR') resultado FROM (
 SELECT 'empresas' tabla,'id' columnas UNION ALL SELECT 'usuarios','id' UNION ALL SELECT 'canecas_productos','empresa_id,id'
 UNION ALL SELECT 'canecas_ubicaciones','empresa_id,id' UNION ALL SELECT 'canecas_compras','empresa_id,id' UNION ALL SELECT 'canecas_recepciones','empresa_id,id'
) e LEFT JOIN (
 SELECT TABLE_NAME,GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') columnas FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND NON_UNIQUE=0 GROUP BY TABLE_NAME,INDEX_NAME
) i ON i.TABLE_NAME=e.tabla AND i.columnas=e.columnas ORDER BY e.tabla;
-- Comparar tipos, signos, índices y cotejamientos con el DDL revisado antes de continuar.
SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos') ORDER BY TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_compras','canecas_recepciones','canecas_movimientos') AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;
-- Revisar CREATE, ALTER, INDEX, REFERENCES y TRIGGER, además de SELECT para los diagnósticos.
-- Los permisos heredados por roles deben verificarse con las herramientas del servidor.
SHOW GRANTS FOR CURRENT_USER;
-- Ejecutar esta consulta únicamente cuando el tablero confirme las tablas base.
-- No convertir automáticamente existencias históricas en otra unidad a canecas.
SELECT 'existencias históricas en unidades incompatibles' AS comprobacion,COUNT(*) AS filas,IF(COUNT(*)=0,'REVISAR','DETENER') AS resultado
FROM canecas_saldos s JOIN canecas_productos p ON p.empresa_id=s.empresa_id AND p.id=s.producto_id
WHERE s.fisico>0 AND LOWER(TRIM(p.unidad_inventario)) NOT IN ('caneca','canecas');

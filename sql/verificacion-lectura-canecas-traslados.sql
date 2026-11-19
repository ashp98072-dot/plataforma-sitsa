-- DIAGNOSTICO DE SOLO LECTURA: PR #650. Seleccionar la base antes de ejecutar.
-- Solo SELECT sobre variables y metadatos. No lee registros de negocio ni realiza DDL/DML.
-- Usar una cuenta autorizada que pueda ver todas las tablas, triggers y rutinas relevantes.
-- Ausencia de resultados puede significar permisos insuficientes: no interpretar como APTO.
-- Revisar los resultados con la migracion, backup verificado y privilegios de instalacion.
-- Este diagnostico no autoriza ni ejecuta migracion, rollback, merge ni despliegue.

-- 1. Identidad del servidor y la base; guardar estos resultados para la revision.
SELECT DATABASE() AS base_seleccionada, VERSION() AS version_servidor,
       @@version_comment AS variante_servidor, @@sql_mode AS sql_mode,
       CURRENT_USER() AS cuenta_efectiva,
       s.default_character_set_name AS charset_base, s.default_collation_name AS collation_base
FROM (SELECT 1 AS n) x LEFT JOIN information_schema.schemata s ON s.schema_name=DATABASE();

-- 2. Tablas requeridas: cualquier DETENER impide la instalacion.
SELECT e.tabla, COALESCE(t.table_type,'AUSENTE') AS tipo,
       COALESCE(t.engine,'AUSENTE') AS motor, t.table_collation AS cotejamiento,
       CASE WHEN DATABASE() IS NULL OR t.table_name IS NULL OR t.table_type <> 'BASE TABLE' OR t.engine <> 'InnoDB'
            THEN 'DETENER' ELSE 'OK' END AS resultado
FROM (SELECT 'empresas' AS tabla UNION ALL SELECT 'usuarios' UNION ALL SELECT 'canecas_productos'
      UNION ALL SELECT 'canecas_ubicaciones' UNION ALL SELECT 'canecas_saldos' UNION ALL SELECT 'canecas_movimientos') e
LEFT JOIN information_schema.tables t ON t.table_schema=DATABASE() AND t.table_name=e.tabla ORDER BY e.tabla;

-- 3. Claves externas nuevas y saldos existentes: INT firmado y NOT NULL.
-- INT(11) e INT tienen igual tipo; UNSIGNED es incompatible con las FK propuestas.
SELECT e.tabla,e.columna,COALESCE(c.column_type,'AUSENTE') AS tipo_encontrado,c.is_nullable,
       CASE WHEN c.column_name IS NULL OR c.data_type<>'int' OR LOWER(c.column_type) LIKE '%unsigned%'
                 OR c.is_nullable<>'NO' THEN 'DETENER' ELSE 'OK' END AS resultado
FROM (SELECT 'empresas' AS tabla,'id' AS columna UNION ALL SELECT 'usuarios','id'
 UNION ALL SELECT 'canecas_productos','empresa_id' UNION ALL SELECT 'canecas_productos','id'
 UNION ALL SELECT 'canecas_ubicaciones','empresa_id' UNION ALL SELECT 'canecas_ubicaciones','id'
 UNION ALL SELECT 'canecas_saldos','empresa_id' UNION ALL SELECT 'canecas_saldos','producto_id'
 UNION ALL SELECT 'canecas_saldos','ubicacion_id' UNION ALL SELECT 'canecas_saldos','fisico'
 UNION ALL SELECT 'canecas_saldos','reservado'
 UNION ALL SELECT 'canecas_movimientos','empresa_id' UNION ALL SELECT 'canecas_movimientos','producto_id'
 UNION ALL SELECT 'canecas_movimientos','ubicacion_id' UNION ALL SELECT 'canecas_movimientos','cantidad'
 UNION ALL SELECT 'canecas_movimientos','usuario_id') e
LEFT JOIN information_schema.columns c ON c.table_schema=DATABASE() AND c.table_name=e.tabla AND c.column_name=e.columna
ORDER BY e.tabla,e.columna;

-- 3b. Columnas adicionales imprescindibles para las consultas y movimientos.
SELECT e.tabla,e.columna,e.tipo_esperado,e.longitud_minima,
       COALESCE(c.column_type,'AUSENTE') AS tipo_encontrado,c.is_nullable,c.collation_name,
       CASE WHEN c.column_name IS NULL OR c.data_type<>e.tipo_esperado
              OR (e.longitud_minima>0 AND COALESCE(c.character_maximum_length,0)<e.longitud_minima)
              THEN 'DETENER' ELSE 'OK: revisar nulabilidad y valores predeterminados' END AS resultado
FROM (SELECT 'empresas' AS tabla,'nombre' AS columna,'varchar' AS tipo_esperado,200 AS longitud_minima
 UNION ALL SELECT 'empresas','slug','varchar',80 UNION ALL SELECT 'empresas','logo_url','varchar',500
 UNION ALL SELECT 'canecas_productos','nombre','varchar',200 UNION ALL SELECT 'canecas_productos','presentacion','varchar',160
 UNION ALL SELECT 'canecas_productos','activo','tinyint',0 UNION ALL SELECT 'canecas_ubicaciones','nombre','varchar',160
 UNION ALL SELECT 'canecas_ubicaciones','activo','tinyint',0 UNION ALL SELECT 'canecas_movimientos','id','bigint',0
 UNION ALL SELECT 'canecas_movimientos','tipo','varchar',30 UNION ALL SELECT 'canecas_movimientos','documento','varchar',250
 UNION ALL SELECT 'canecas_movimientos','recepcion_id','int',0 UNION ALL SELECT 'canecas_movimientos','creado_en','datetime',0) e
LEFT JOIN information_schema.columns c ON c.table_schema=DATABASE() AND c.table_name=e.tabla AND c.column_name=e.columna
ORDER BY e.tabla,e.columna;

-- 4. Indices unicos exactos requeridos para claves padre y saldo.
SELECT esperado.tabla,esperado.columnas,
       COALESCE(GROUP_CONCAT(DISTINCT encontrado.index_name ORDER BY encontrado.index_name SEPARATOR ', '),'AUSENTE') AS indices_encontrados,
       IF(COUNT(encontrado.index_name)>0,'OK','DETENER') AS resultado
FROM (SELECT 'empresas' AS tabla,'id' AS columnas UNION ALL SELECT 'usuarios','id'
 UNION ALL SELECT 'canecas_productos','empresa_id,id' UNION ALL SELECT 'canecas_ubicaciones','empresa_id,id'
 UNION ALL SELECT 'canecas_saldos','empresa_id,producto_id,ubicacion_id') esperado
LEFT JOIN (SELECT table_name,index_name,GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS columnas
 FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=0
 GROUP BY table_name,index_name) encontrado ON encontrado.table_name=esperado.tabla AND encontrado.columnas=esperado.columnas
GROUP BY esperado.tabla,esperado.columnas ORDER BY esperado.tabla;

-- 5. Todas las columnas usadas por las consultas de la aplicacion: revisar tipos,
-- valores por defecto, longitudes y cotejamientos frente al esquema del repositorio.
SELECT c.table_name,c.ordinal_position,c.column_name,c.column_type,c.is_nullable,c.column_default,
       c.character_set_name,c.collation_name,c.extra
FROM information_schema.columns c WHERE c.table_schema=DATABASE()
AND c.table_name IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_movimientos')
ORDER BY c.table_name,c.ordinal_position;

-- 6. Indices y FK existentes; cotejar orden de columnas, destinos y reglas.
SELECT table_name,index_name,non_unique,seq_in_index,column_name,sub_part,index_type
FROM information_schema.statistics WHERE table_schema=DATABASE()
AND table_name IN ('empresas','usuarios','canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_movimientos')
ORDER BY table_name,index_name,seq_in_index;
SELECT k.table_name,k.constraint_name,k.ordinal_position,k.column_name,k.referenced_table_schema,k.referenced_table_name,k.referenced_column_name,
       r.update_rule,r.delete_rule
FROM information_schema.key_column_usage k LEFT JOIN information_schema.referential_constraints r
 ON r.constraint_schema=k.constraint_schema AND r.table_name=k.table_name AND r.constraint_name=k.constraint_name
WHERE k.table_schema=DATABASE() AND k.referenced_table_name IS NOT NULL
AND k.table_name IN ('canecas_productos','canecas_ubicaciones','canecas_saldos','canecas_movimientos')
ORDER BY k.table_name,k.constraint_name,k.ordinal_position;

-- 7. Objetos nuevos: cero de cada uno es el unico estado previo previsto.
SELECT e.objeto,IF(t.table_name IS NULL,'AUSENTE','PRESENTE') AS estado,
       CASE WHEN DATABASE() IS NULL THEN 'DETENER: seleccione base'
            WHEN t.table_name IS NULL THEN 'OK' ELSE 'DETENER: existente o instalacion parcial' END AS resultado
FROM (SELECT 'canecas_traslados' AS objeto UNION ALL SELECT 'canecas_traslado_partidas'
 UNION ALL SELECT 'canecas_traslado_recepciones' UNION ALL SELECT 'canecas_traslado_recepcion_partidas'
 UNION ALL SELECT 'canecas_traslado_documentos') e
LEFT JOIN information_schema.tables t ON t.table_schema=DATABASE() AND t.table_name=e.objeto ORDER BY e.objeto;
SELECT trigger_name,event_object_table,action_timing,event_manipulation FROM information_schema.triggers
WHERE trigger_schema=DATABASE() AND trigger_name IN ('can_tras_doc_no_update','can_tras_doc_no_delete');
SELECT routine_name,routine_type FROM information_schema.routines
WHERE routine_schema=DATABASE() AND routine_name='can_tras_rollback_vacio';
SELECT constraint_name,table_name,constraint_type FROM information_schema.table_constraints
WHERE constraint_schema=DATABASE() AND constraint_name IN ('fk_can_tras_origen','fk_can_tras_destino','fk_can_tras_creador','fk_can_tras_emisor','fk_can_tras_par_tras','fk_can_tras_par_prod','fk_can_tras_rec_tras','fk_can_tras_rec_usuario','fk_can_tras_rp_recepcion','fk_can_tras_rp_partida','fk_can_tras_doc_tras','fk_can_tras_doc_usuario') ORDER BY constraint_name;

-- 8. Permisos visibles de la cuenta: informativo, puede omitir privilegios por rol.
-- La persona administradora debe verificar efectividad de CREATE, ALTER, DROP,
-- REFERENCES, TRIGGER y rutinas, asi como restricciones gestionadas del servidor.
-- No usar GRANT ni asumir que ausencia en estas vistas significa ausencia de acceso.
SELECT 'global' AS ambito,privilege_type,is_grantable FROM information_schema.user_privileges WHERE grantee=CONCAT(CHAR(39),SUBSTRING_INDEX(CURRENT_USER(),'@',1),CHAR(39),'@',CHAR(39),SUBSTRING_INDEX(CURRENT_USER(),'@',-1),CHAR(39))
UNION ALL SELECT 'base',privilege_type,is_grantable FROM information_schema.schema_privileges WHERE table_schema=DATABASE() AND grantee=CONCAT(CHAR(39),SUBSTRING_INDEX(CURRENT_USER(),'@',1),CHAR(39),'@',CHAR(39),SUBSTRING_INDEX(CURRENT_USER(),'@',-1),CHAR(39)) ORDER BY ambito,privilege_type;
SELECT 'REVISAR: CHECK, JSON, SIGNAL, triggers, soporte de motor/version, permisos efectivos y collation; no hay veredicto automatico de instalacion.' AS revision_manual;

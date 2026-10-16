-- C-2C - POSTCHECK (SOLO LECTURA). Ejecutar tras la migracion. Exige FINAL; todos los conteos de problemas deben ser 0.
-- Se GENERA con scripts/generar-sql-c2c.py (no editar a mano).
-- BEGIN C2C CONTRACT AUDIT (identico en preflight/migrate/postcheck; SELECT INTO solo asigna variables de sesion)
SELECT NULL,NULL,NULL,NULL INTO @c2c_estado,@c2c_esperados,@c2c_presentes,@c2c_correctos;
WITH
columnas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["estado_c2c","varchar","varchar(30)",1],["modo_c2c","varchar","varchar(10)",1],["carga_vinculada_id","int","int(11)",0],["carga_sugerida_id","int","int(11)",0],["diferencias_c2c","longtext","longtext",2],["calculado_en","datetime","datetime",0],["confirmado_por_usuario_id","int","int(11)",0],["confirmado_en","datetime","datetime",0]]','$[*]'
 COLUMNS(nombre VARCHAR(64) PATH '$[0]', tipo VARCHAR(20) PATH '$[1]', tipo_col VARCHAR(30) PATH '$[2]', texto INT PATH '$[3]')) j
),
indices_esperados AS (
 SELECT j.* FROM JSON_TABLE('[["uq_fccif_vinculo","empresa_id,carga_vinculada_id",0],["idx_fccif_c2c","empresa_id,conciliacion_id,estado_c2c",1],["idx_fccif_sugerida","empresa_id,carga_sugerida_id",1]]','$[*]'
 COLUMNS(nombre VARCHAR(64) PATH '$[0]', columnas VARCHAR(255) PATH '$[1]', no_unico INT PATH '$[2]')) j
),
checks_esperados AS (
 SELECT 'chk_fccif_estado_c2c' nombre,'estado_c2cisnullorestado_c2cin(''PENDIENTE'',''COINCIDENCIA_EXACTA'',''COINCIDENCIA_CON_DIFERENCIAS'',''SIN_VALE_INTERNO'',''VALE_INTERNO_SIN_REPORTE'',''AMBIGUA'',''DESCARTADA_MANUAL'')' clausula
 UNION ALL SELECT 'chk_fccif_modo_c2c','modo_c2cisnullormodo_c2cin(''AUTO'',''MANUAL'')'
 UNION ALL SELECT 'chk_fccif_vinculo_estado','carga_vinculada_idisnullorestado_c2cin(''COINCIDENCIA_EXACTA'',''COINCIDENCIA_CON_DIFERENCIAS'')'
 UNION ALL SELECT 'chk_fccif_diferencias_json','diferencias_c2cisnullorjson_valid(diferencias_c2c)'
),
fks_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["fk_fccif_vinculo","carga_vinculada_id","flota_combustible_cargas","id"],["fk_fccif_sugerida","carga_sugerida_id","flota_combustible_cargas","id"],["fk_fccif_confirmo","confirmado_por_usuario_id","usuarios","id"]]','$[*]'
 COLUMNS(nombre VARCHAR(64) PATH '$[0]', columnas VARCHAR(255) PATH '$[1]', padre VARCHAR(64) PATH '$[2]', columnas_padre VARCHAR(255) PATH '$[3]')) j
),
indices_reales AS (
 SELECT INDEX_NAME nombre, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas, MAX(NON_UNIQUE) no_unico, SUM(SUB_PART IS NOT NULL) prefijos,
 SUM(INDEX_TYPE<>'BTREE' OR COLLATION<>'A' OR IGNORED<>'NO') incompatibles
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas' GROUP BY INDEX_NAME
),
fks_reales AS (
 SELECT k.CONSTRAINT_NAME nombre, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas, MAX(k.REFERENCED_TABLE_NAME) padre,
 MAX(k.REFERENCED_TABLE_SCHEMA) esquema_padre, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_padre,
 MAX(r.UPDATE_RULE) regla_update, MAX(r.DELETE_RULE) regla_delete
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME='flota_combustible_conciliacion_filas' GROUP BY k.CONSTRAINT_NAME
),
objetos AS (
 SELECT CONCAT('columna:',e.nombre) objeto,(c.COLUMN_NAME IS NOT NULL) presente,
 COALESCE(c.DATA_TYPE=e.tipo AND c.COLUMN_TYPE=e.tipo_col AND c.IS_NULLABLE='YES' AND (c.COLUMN_DEFAULT IS NULL OR c.COLUMN_DEFAULT='NULL') AND c.EXTRA=''
 AND CASE e.texto
   WHEN 0 THEN c.CHARACTER_SET_NAME IS NULL
   WHEN 1 THEN c.CHARACTER_SET_NAME='utf8mb4' AND c.COLLATION_NAME=t.TABLE_COLLATION
   ELSE c.CHARACTER_SET_NAME='utf8mb4' AND c.COLLATION_NAME='utf8mb4_bin' AND EXISTS(SELECT 1 FROM information_schema.CHECK_CONSTRAINTS ck
     WHERE ck.CONSTRAINT_SCHEMA=DATABASE() AND ck.TABLE_NAME='flota_combustible_conciliacion_filas'
     AND REGEXP_REPLACE(REPLACE(LOWER(ck.CHECK_CLAUSE),CHAR(96),''),'[[:space:]]','')=CONCAT('json_valid(',e.nombre,')')) END,0) correcto
 FROM columnas_esperadas e LEFT JOIN information_schema.COLUMNS c
 ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME='flota_combustible_conciliacion_filas' AND c.COLUMN_NAME=e.nombre
 LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME='flota_combustible_conciliacion_filas'
 UNION ALL
 SELECT CONCAT('indice:',e.nombre),(r.nombre IS NOT NULL),
 COALESCE(r.columnas=e.columnas AND r.no_unico=e.no_unico AND r.prefijos=0 AND r.incompatibles=0,0)
 FROM indices_esperados e LEFT JOIN indices_reales r ON r.nombre=e.nombre
 UNION ALL
 SELECT CONCAT('check:',e.nombre),(ck.CONSTRAINT_NAME IS NOT NULL),
 COALESCE(REGEXP_REPLACE(REPLACE(ck.CHECK_CLAUSE,CHAR(96),''),'[[:space:]]','')=e.clausula,0)
 FROM checks_esperados e LEFT JOIN information_schema.CHECK_CONSTRAINTS ck
 ON ck.CONSTRAINT_SCHEMA=DATABASE() AND ck.TABLE_NAME='flota_combustible_conciliacion_filas' AND ck.CONSTRAINT_NAME=e.nombre
 UNION ALL
 SELECT CONCAT('fk:',e.nombre),(r.nombre IS NOT NULL),
 COALESCE(r.columnas=e.columnas AND r.padre=e.padre AND r.columnas_padre=e.columnas_padre AND r.esquema_padre=DATABASE()
 AND r.regla_update='RESTRICT' AND r.regla_delete='RESTRICT',0)
 FROM fks_esperadas e LEFT JOIN fks_reales r ON r.nombre=e.nombre
),
conteos AS (SELECT COUNT(*) esperados,SUM(presente) presentes,SUM(correcto) correctos FROM objetos),
base AS (
 SELECT (DATABASE() IS NOT NULL AND VERSION() LIKE '11.8.%MariaDB%' AND @@foreign_key_checks=1 AND @@check_constraint_checks=1
 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
   AND TABLE_NAME IN ('flota_combustible_conciliaciones','flota_combustible_conciliacion_filas','flota_combustible_cargas','usuarios') AND ENGINE='InnoDB')=4
 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE='int' AND COLUMN_TYPE='int(11)' AND IS_NULLABLE='NO'
   AND ((TABLE_NAME='flota_combustible_conciliacion_filas' AND COLUMN_NAME IN ('id','empresa_id','conciliacion_id'))
     OR (TABLE_NAME='flota_combustible_cargas' AND COLUMN_NAME='id') OR (TABLE_NAME='usuarios' AND COLUMN_NAME='id')))=5
 AND (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND INDEX_NAME='PRIMARY' AND COLUMN_NAME='id' AND SEQ_IN_INDEX=1
   AND TABLE_NAME IN ('flota_combustible_conciliacion_filas','flota_combustible_cargas','usuarios'))=3
 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas'
   AND COLUMN_NAME IN ('hoja_origen','estado_parseo','datos_importacion','fingerprint','duplicado_tipo','duplicado_de_linea_id'))=6
 AND EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliaciones' AND COLUMN_NAME IN ('perfil_parser','proveedor_id') GROUP BY TABLE_NAME HAVING COUNT(*)=2)
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas' AND INDEX_NAME='uq_fccif_empresa_import_id')
 AND EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas' AND CONSTRAINT_NAME='fk_fccif_canonica')) ok
)
SELECT CASE WHEN NOT base.ok THEN 'DIVERGENTE'
 WHEN conteos.presentes=0 AND NOT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas'
   AND INDEX_NAME IN ('fk_fccif_vinculo','fk_fccif_sugerida','fk_fccif_confirmo')) THEN 'CLEAN'
 WHEN conteos.esperados=18 AND conteos.presentes=18 AND conteos.correctos=18 THEN 'FINAL'
 ELSE 'DIVERGENTE' END,conteos.esperados,conteos.presentes,conteos.correctos
INTO @c2c_estado,@c2c_esperados,@c2c_presentes,@c2c_correctos
FROM conteos CROSS JOIN base;
-- END C2C CONTRACT AUDIT
SELECT (SELECT COUNT(*) FROM flota_combustible_conciliacion_filas),(SELECT COUNT(*) FROM flota_combustible_conciliaciones),
 (SELECT COUNT(*) FROM flota_combustible_cargas),(SELECT COUNT(*) FROM usuarios)
INTO @c2c_n_filas,@c2c_n_cabeceras,@c2c_n_cargas,@c2c_n_usuarios;
-- BEGIN C2C DATA AUDIT (solo lecturas)
SELECT NULL,NULL,NULL,NULL INTO @c2c_vinculos,@c2c_sugeridas,@c2c_vinculos_duplicados,@c2c_vinculos_huerfanos;
DELIMITER $$
BEGIN NOT ATOMIC
 IF @c2c_estado='FINAL' THEN
  SET @c2c_lectura='SELECT COUNT(*),SUM(carga_sugerida_id IS NOT NULL) INTO @c2c_vinculos,@c2c_sugeridas FROM flota_combustible_conciliacion_filas WHERE carga_vinculada_id IS NOT NULL OR carga_sugerida_id IS NOT NULL';
  PREPARE c2c_read FROM @c2c_lectura; EXECUTE c2c_read; DEALLOCATE PREPARE c2c_read;
  SET @c2c_lectura='SELECT COUNT(*) INTO @c2c_vinculos_duplicados FROM (SELECT empresa_id,carga_vinculada_id FROM flota_combustible_conciliacion_filas WHERE carga_vinculada_id IS NOT NULL GROUP BY empresa_id,carga_vinculada_id HAVING COUNT(*)>1) x';
  PREPARE c2c_read FROM @c2c_lectura; EXECUTE c2c_read; DEALLOCATE PREPARE c2c_read;
  SET @c2c_lectura='SELECT COUNT(*) INTO @c2c_vinculos_huerfanos FROM flota_combustible_conciliacion_filas f LEFT JOIN flota_combustible_cargas c ON c.id=f.carga_vinculada_id WHERE f.carga_vinculada_id IS NOT NULL AND (c.id IS NULL OR c.empresa_id<>f.empresa_id)';
  PREPARE c2c_read FROM @c2c_lectura; EXECUTE c2c_read; DEALLOCATE PREPARE c2c_read;
 END IF;
END$$
DELIMITER ;
-- END C2C DATA AUDIT
DELIMITER $$
BEGIN NOT ATOMIC
 IF @c2c_estado IS NULL OR @c2c_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: postcheck C2C exige FINAL (objetos, indices, CHECK y FK exactos)';
 END IF;
 IF COALESCE(@c2c_vinculos_duplicados,0)+COALESCE(@c2c_vinculos_huerfanos,0)>0 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: vinculos C2C duplicados u huerfanos';
 END IF;
END$$
DELIMITER ;
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@c2c_estado estado_c2c_rollout,@c2c_esperados objetos_esperados,@c2c_presentes objetos_presentes,@c2c_correctos objetos_correctos,
 @c2c_n_filas filas_c2b_total,@c2c_n_cargas vales_total,@c2c_vinculos filas_con_vinculo_o_sugerida,@c2c_sugeridas filas_con_sugerida,@c2c_vinculos_duplicados vinculos_duplicados,@c2c_vinculos_huerfanos vinculos_huerfanos;
-- Integridad logica adicional (deben ser 0 siempre):
SELECT COUNT(*) AS vinculos_de_otro_proveedor FROM flota_combustible_conciliacion_filas f
 JOIN flota_combustible_conciliaciones h ON h.empresa_id=f.empresa_id AND h.id=f.conciliacion_id
 JOIN flota_combustible_cargas c ON c.id=f.carga_vinculada_id WHERE c.proveedor_id<>h.proveedor_id OR c.proveedor_id IS NULL;
SELECT COUNT(*) AS vinculos_en_filas_no_canonicas FROM flota_combustible_conciliacion_filas
 WHERE carga_vinculada_id IS NOT NULL AND (duplicado_de_linea_id IS NOT NULL OR estado_parseo IN ('INVALIDA','IGNORADA'));
SELECT COUNT(*) AS sugeridas_huerfanas FROM flota_combustible_conciliacion_filas f LEFT JOIN flota_combustible_cargas c ON c.id=f.carga_sugerida_id
 WHERE f.carga_sugerida_id IS NOT NULL AND (c.id IS NULL OR c.empresa_id<>f.empresa_id);

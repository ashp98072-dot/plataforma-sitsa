-- C-2C - MIGRACION (PROPUESTA; NO ejecutada en produccion por la rama). Ejecutar SOLO tras preflight revisado y autorizado.
-- Reconoce unicamente CLEAN (aplica DDL), FINAL (NOOP) y DIVERGENTE (SIGNAL antes de cualquier DDL). Sin estados parciales continuables.
-- DDL determinista (sin IF NOT EXISTS). Sin DML ni backfill. Tras el DDL repite la auditoria en la MISMA sesion y exige FINAL y conteos identicos.
-- Misma sesion; no ejecutar bloques sueltos. Se GENERA con scripts/generar-sql-c2c.py (no editar a mano).
-- BEGIN C2B CONTRACT AUDIT (idéntico en preflight/migrate/postcheck)
-- SELECT INTO solo asigna variables de esta sesión; no modifica tablas.
SELECT NULL,NULL,NULL,NULL,NULL INTO @c2b_estado,@c2b_h_presentes,@c2b_h_correctos,@c2b_f_presentes,@c2b_f_correctos;
WITH
columnas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["H","flota_combustible_conciliaciones","proveedor_id","int",null,0,0],["H","flota_combustible_conciliaciones","proveedor_nombre","varchar",200,0,0],["H","flota_combustible_conciliaciones","archivo_sha256","char",64,0,0],["H","flota_combustible_conciliaciones","perfil_parser","varchar",40,0,0],["H","flota_combustible_conciliaciones","version_parser","smallint",null,0,0],["H","flota_combustible_conciliaciones","estado_importacion","varchar",20,0,0],["H","flota_combustible_conciliaciones","resumen_importacion","longtext",null,1,1],["H","flota_combustible_conciliaciones","subido_por_usuario_id","int",null,0,0],["F","flota_combustible_conciliacion_filas","hoja_origen","varchar",128,1,0],["F","flota_combustible_conciliacion_filas","estado_parseo","varchar",20,0,0],["F","flota_combustible_conciliacion_filas","datos_importacion","longtext",null,1,1],["F","flota_combustible_conciliacion_filas","origen_celdas","longtext",null,1,1],["F","flota_combustible_conciliacion_filas","fingerprint","char",64,0,0],["F","flota_combustible_conciliacion_filas","clave_operacion","char",64,0,0],["F","flota_combustible_conciliacion_filas","duplicado_tipo","varchar",30,0,0],["F","flota_combustible_conciliacion_filas","duplicado_previo","tinyint",null,0,0],["F","flota_combustible_conciliacion_filas","duplicado_de_linea_id","int",null,0,0]]', '$[*]' COLUMNS(
 ambito CHAR(1) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 tipo VARCHAR(20) PATH '$[3]', longitud INT PATH '$[4]', binaria INT PATH '$[5]', es_json INT PATH '$[6]')) j
),
indices_esperados AS (
 SELECT j.* FROM JSON_TABLE('[["H","flota_combustible_conciliaciones","uq_fcci_empresa_id","empresa_id,id",0],["H","flota_combustible_conciliaciones","uq_fcci_archivo","empresa_id,proveedor_id,archivo_sha256",0],["H","flota_combustible_conciliaciones","idx_fcci_perfil","empresa_id,perfil_parser,id",1],["F","flota_combustible_conciliacion_filas","uq_fccif_empresa_import_id","empresa_id,conciliacion_id,id",0],["F","flota_combustible_conciliacion_filas","uq_fccif_origen","empresa_id,conciliacion_id,hoja_origen,fila_excel",0],["F","flota_combustible_conciliacion_filas","idx_fccif_fingerprint","empresa_id,fingerprint",1],["F","flota_combustible_conciliacion_filas","idx_fccif_clave","empresa_id,clave_operacion",1],["F","flota_combustible_conciliacion_filas","idx_fccif_canonica","empresa_id,conciliacion_id,duplicado_de_linea_id",1]]', '$[*]' COLUMNS(
 ambito CHAR(1) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 columnas VARCHAR(255) PATH '$[3]', no_unico INT PATH '$[4]')) j
),
fks_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["H","flota_combustible_conciliaciones","fk_fcci_empresa","empresa_id","empresas","id"],["H","flota_combustible_conciliaciones","fk_fcci_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],["H","flota_combustible_conciliaciones","fk_fcci_usuario","subido_por_usuario_id","usuarios","id"],["F","flota_combustible_conciliacion_filas","fk_fccif_importacion","empresa_id,conciliacion_id","flota_combustible_conciliaciones","empresa_id,id"],["F","flota_combustible_conciliacion_filas","fk_fccif_canonica","empresa_id,conciliacion_id,duplicado_de_linea_id","flota_combustible_conciliacion_filas","empresa_id,conciliacion_id,id"]]', '$[*]' COLUMNS(
 ambito CHAR(1) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 columnas VARCHAR(255) PATH '$[3]', padre VARCHAR(64) PATH '$[4]', columnas_padre VARCHAR(255) PATH '$[5]')) j
),
ids_base AS (
 SELECT j.* FROM JSON_TABLE('[["empresas","id"],["usuarios","id"],["compras_proveedores","id"],["compras_proveedores","empresa_id"],["flota_combustible_conciliaciones","id"],["flota_combustible_conciliaciones","empresa_id"],["flota_combustible_conciliacion_filas","id"],["flota_combustible_conciliacion_filas","empresa_id"],["flota_combustible_conciliacion_filas","conciliacion_id"]]', '$[*]' COLUMNS(
 tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]')) j
),
indices_reales AS (
 SELECT TABLE_NAME tabla, INDEX_NAME nombre, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas,
 MAX(NON_UNIQUE) no_unico, SUM(SUB_PART IS NOT NULL) prefijos,
 SUM(INDEX_TYPE<>'BTREE' OR COLLATION<>'A' OR IGNORED<>'NO') incompatibles
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
 GROUP BY TABLE_NAME,INDEX_NAME
),
fks_reales AS (
 SELECT k.TABLE_NAME tabla,k.CONSTRAINT_NAME nombre,
 GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas,
 MAX(k.REFERENCED_TABLE_NAME) padre,MAX(k.REFERENCED_TABLE_SCHEMA) esquema_padre,
 GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_padre,
 MAX(r.UPDATE_RULE) regla_update,MAX(r.DELETE_RULE) regla_delete
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() GROUP BY k.TABLE_NAME,k.CONSTRAINT_NAME
),
objetos AS (
 SELECT e.ambito,CONCAT('columna:',e.nombre) objeto,(c.COLUMN_NAME IS NOT NULL) presente,
 COALESCE(c.DATA_TYPE=e.tipo AND c.IS_NULLABLE='YES' AND (c.COLUMN_DEFAULT IS NULL OR c.COLUMN_DEFAULT='NULL')
 AND c.EXTRA='' AND c.COLUMN_TYPE NOT LIKE '%unsigned%'
 AND (e.longitud IS NULL OR c.CHARACTER_MAXIMUM_LENGTH=e.longitud)
 AND (e.tipo NOT IN ('varchar','char','longtext') OR (c.CHARACTER_SET_NAME='utf8mb4'
   AND c.COLLATION_NAME=IF(e.binaria=1,'utf8mb4_bin',t.TABLE_COLLATION)))
 AND (e.tipo<>'tinyint' OR c.COLUMN_TYPE='tinyint(1)')
 AND (e.es_json=0 OR EXISTS(SELECT 1 FROM information_schema.CHECK_CONSTRAINTS ck
   WHERE ck.CONSTRAINT_SCHEMA=DATABASE() AND ck.TABLE_NAME=e.tabla
   AND REGEXP_REPLACE(REPLACE(LOWER(ck.CHECK_CLAUSE),CHAR(96),''),'[[:space:]]','')=CONCAT('json_valid(',e.nombre,')'))),0) correcto
 FROM columnas_esperadas e LEFT JOIN information_schema.COLUMNS c
 ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.nombre
 LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=e.tabla
 UNION ALL
 SELECT e.ambito,CONCAT('indice:',e.nombre),r.nombre IS NOT NULL,
 COALESCE(r.columnas=e.columnas AND r.no_unico=e.no_unico AND r.prefijos=0 AND r.incompatibles=0,0)
 FROM indices_esperados e LEFT JOIN indices_reales r ON r.tabla=e.tabla AND r.nombre=e.nombre
 UNION ALL
 SELECT e.ambito,CONCAT('fk:',e.nombre),
 EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS tc WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.CONSTRAINT_NAME=e.nombre),
 COALESCE(r.columnas=e.columnas AND r.padre=e.padre AND r.columnas_padre=e.columnas_padre
 AND r.esquema_padre=DATABASE() AND r.regla_update='RESTRICT' AND r.regla_delete='RESTRICT',0)
 FROM fks_esperadas e LEFT JOIN fks_reales r ON r.tabla=e.tabla AND r.nombre=e.nombre
),
conteos AS (
 SELECT SUM(ambito='H' AND presente) hp,SUM(ambito='H' AND correcto) hc,
 SUM(ambito='F' AND presente) fp,SUM(ambito='F' AND correcto) fc FROM objetos
),
base AS (
 SELECT (DATABASE() IS NOT NULL AND VERSION() LIKE '11.8.%MariaDB%'
 AND @@foreign_key_checks=1 AND @@check_constraint_checks=1
 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
   AND TABLE_NAME IN ('empresas','usuarios','compras_proveedores','flota_combustible_conciliaciones','flota_combustible_conciliacion_filas','auditoria') AND ENGINE='InnoDB')=6
 AND (SELECT COUNT(*) FROM ids_base e JOIN information_schema.COLUMNS c
   ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.nombre
   WHERE c.DATA_TYPE='int' AND c.COLUMN_TYPE NOT LIKE '%unsigned%' AND c.IS_NULLABLE='NO')=9
 AND (SELECT COUNT(*) FROM indices_reales WHERE tabla IN ('empresas','usuarios','compras_proveedores','flota_combustible_conciliaciones','flota_combustible_conciliacion_filas')
   AND nombre='PRIMARY' AND columnas='id' AND no_unico=0 AND prefijos=0 AND incompatibles=0)=5
 AND EXISTS(SELECT 1 FROM indices_reales WHERE tabla='compras_proveedores' AND columnas='empresa_id,id' AND no_unico=0 AND prefijos=0 AND incompatibles=0)) ok
)
SELECT CASE WHEN NOT base.ok THEN 'DIVERGENTE'
 WHEN hp=0 AND fp=0 THEN 'CLEAN'
 WHEN hp=14 AND hc=14 AND fp=0 THEN 'PARTIAL_HEADER_COMPLETE'
 WHEN hp=14 AND hc=14 AND fp=16 AND fc=16 THEN 'FINAL'
 ELSE 'DIVERGENTE' END,hp,hc,fp,fc
INTO @c2b_estado,@c2b_h_presentes,@c2b_h_correctos,@c2b_f_presentes,@c2b_f_correctos
FROM conteos CROSS JOIN base;
-- END C2B CONTRACT AUDIT
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
SELECT CASE WHEN NOT base.ok OR COALESCE(@c2b_estado,'')<>'FINAL' THEN 'DIVERGENTE'
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
SELECT @c2c_estado INTO @c2c_inicial;
DELIMITER $$
BEGIN NOT ATOMIC
 IF @c2c_estado IS NULL OR @c2c_estado NOT IN ('CLEAN','FINAL') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: contrato C2C DIVERGENTE; no se ejecuto DDL';
 END IF;
 IF @c2c_estado='CLEAN' THEN
  ALTER TABLE flota_combustible_conciliacion_filas
   ADD COLUMN estado_c2c VARCHAR(30) NULL,
   ADD COLUMN modo_c2c VARCHAR(10) NULL,
   ADD COLUMN carga_vinculada_id INT NULL,
   ADD COLUMN carga_sugerida_id INT NULL,
   ADD COLUMN diferencias_c2c JSON NULL,
   ADD COLUMN calculado_en DATETIME NULL,
   ADD COLUMN confirmado_por_usuario_id INT NULL,
   ADD COLUMN confirmado_en DATETIME NULL;
  ALTER TABLE flota_combustible_conciliacion_filas
   ADD UNIQUE INDEX uq_fccif_vinculo (empresa_id,carga_vinculada_id),
   ADD INDEX idx_fccif_c2c (empresa_id,conciliacion_id,estado_c2c),
   ADD INDEX idx_fccif_sugerida (empresa_id,carga_sugerida_id);
  ALTER TABLE flota_combustible_conciliacion_filas
   ADD CONSTRAINT chk_fccif_estado_c2c CHECK (estado_c2c IS NULL OR estado_c2c IN ('PENDIENTE','COINCIDENCIA_EXACTA','COINCIDENCIA_CON_DIFERENCIAS','SIN_VALE_INTERNO','VALE_INTERNO_SIN_REPORTE','AMBIGUA','DESCARTADA_MANUAL')),
   ADD CONSTRAINT chk_fccif_modo_c2c CHECK (modo_c2c IS NULL OR modo_c2c IN ('AUTO','MANUAL')),
   ADD CONSTRAINT chk_fccif_vinculo_estado CHECK (carga_vinculada_id IS NULL OR estado_c2c IN ('COINCIDENCIA_EXACTA','COINCIDENCIA_CON_DIFERENCIAS')),
   ADD CONSTRAINT chk_fccif_diferencias_json CHECK (diferencias_c2c IS NULL OR JSON_VALID(diferencias_c2c));
  ALTER TABLE flota_combustible_conciliacion_filas
   ADD CONSTRAINT fk_fccif_vinculo FOREIGN KEY (carga_vinculada_id) REFERENCES flota_combustible_cargas(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
   ADD CONSTRAINT fk_fccif_sugerida FOREIGN KEY (carga_sugerida_id) REFERENCES flota_combustible_cargas(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
   ADD CONSTRAINT fk_fccif_confirmo FOREIGN KEY (confirmado_por_usuario_id) REFERENCES usuarios(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
 END IF;
END$$
DELIMITER ;
-- BEGIN C2B CONTRACT AUDIT (idéntico en preflight/migrate/postcheck)
-- SELECT INTO solo asigna variables de esta sesión; no modifica tablas.
SELECT NULL,NULL,NULL,NULL,NULL INTO @c2b_estado,@c2b_h_presentes,@c2b_h_correctos,@c2b_f_presentes,@c2b_f_correctos;
WITH
columnas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["H","flota_combustible_conciliaciones","proveedor_id","int",null,0,0],["H","flota_combustible_conciliaciones","proveedor_nombre","varchar",200,0,0],["H","flota_combustible_conciliaciones","archivo_sha256","char",64,0,0],["H","flota_combustible_conciliaciones","perfil_parser","varchar",40,0,0],["H","flota_combustible_conciliaciones","version_parser","smallint",null,0,0],["H","flota_combustible_conciliaciones","estado_importacion","varchar",20,0,0],["H","flota_combustible_conciliaciones","resumen_importacion","longtext",null,1,1],["H","flota_combustible_conciliaciones","subido_por_usuario_id","int",null,0,0],["F","flota_combustible_conciliacion_filas","hoja_origen","varchar",128,1,0],["F","flota_combustible_conciliacion_filas","estado_parseo","varchar",20,0,0],["F","flota_combustible_conciliacion_filas","datos_importacion","longtext",null,1,1],["F","flota_combustible_conciliacion_filas","origen_celdas","longtext",null,1,1],["F","flota_combustible_conciliacion_filas","fingerprint","char",64,0,0],["F","flota_combustible_conciliacion_filas","clave_operacion","char",64,0,0],["F","flota_combustible_conciliacion_filas","duplicado_tipo","varchar",30,0,0],["F","flota_combustible_conciliacion_filas","duplicado_previo","tinyint",null,0,0],["F","flota_combustible_conciliacion_filas","duplicado_de_linea_id","int",null,0,0]]', '$[*]' COLUMNS(
 ambito CHAR(1) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 tipo VARCHAR(20) PATH '$[3]', longitud INT PATH '$[4]', binaria INT PATH '$[5]', es_json INT PATH '$[6]')) j
),
indices_esperados AS (
 SELECT j.* FROM JSON_TABLE('[["H","flota_combustible_conciliaciones","uq_fcci_empresa_id","empresa_id,id",0],["H","flota_combustible_conciliaciones","uq_fcci_archivo","empresa_id,proveedor_id,archivo_sha256",0],["H","flota_combustible_conciliaciones","idx_fcci_perfil","empresa_id,perfil_parser,id",1],["F","flota_combustible_conciliacion_filas","uq_fccif_empresa_import_id","empresa_id,conciliacion_id,id",0],["F","flota_combustible_conciliacion_filas","uq_fccif_origen","empresa_id,conciliacion_id,hoja_origen,fila_excel",0],["F","flota_combustible_conciliacion_filas","idx_fccif_fingerprint","empresa_id,fingerprint",1],["F","flota_combustible_conciliacion_filas","idx_fccif_clave","empresa_id,clave_operacion",1],["F","flota_combustible_conciliacion_filas","idx_fccif_canonica","empresa_id,conciliacion_id,duplicado_de_linea_id",1]]', '$[*]' COLUMNS(
 ambito CHAR(1) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 columnas VARCHAR(255) PATH '$[3]', no_unico INT PATH '$[4]')) j
),
fks_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["H","flota_combustible_conciliaciones","fk_fcci_empresa","empresa_id","empresas","id"],["H","flota_combustible_conciliaciones","fk_fcci_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],["H","flota_combustible_conciliaciones","fk_fcci_usuario","subido_por_usuario_id","usuarios","id"],["F","flota_combustible_conciliacion_filas","fk_fccif_importacion","empresa_id,conciliacion_id","flota_combustible_conciliaciones","empresa_id,id"],["F","flota_combustible_conciliacion_filas","fk_fccif_canonica","empresa_id,conciliacion_id,duplicado_de_linea_id","flota_combustible_conciliacion_filas","empresa_id,conciliacion_id,id"]]', '$[*]' COLUMNS(
 ambito CHAR(1) PATH '$[0]', tabla VARCHAR(64) PATH '$[1]', nombre VARCHAR(64) PATH '$[2]',
 columnas VARCHAR(255) PATH '$[3]', padre VARCHAR(64) PATH '$[4]', columnas_padre VARCHAR(255) PATH '$[5]')) j
),
ids_base AS (
 SELECT j.* FROM JSON_TABLE('[["empresas","id"],["usuarios","id"],["compras_proveedores","id"],["compras_proveedores","empresa_id"],["flota_combustible_conciliaciones","id"],["flota_combustible_conciliaciones","empresa_id"],["flota_combustible_conciliacion_filas","id"],["flota_combustible_conciliacion_filas","empresa_id"],["flota_combustible_conciliacion_filas","conciliacion_id"]]', '$[*]' COLUMNS(
 tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]')) j
),
indices_reales AS (
 SELECT TABLE_NAME tabla, INDEX_NAME nombre, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas,
 MAX(NON_UNIQUE) no_unico, SUM(SUB_PART IS NOT NULL) prefijos,
 SUM(INDEX_TYPE<>'BTREE' OR COLLATION<>'A' OR IGNORED<>'NO') incompatibles
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
 GROUP BY TABLE_NAME,INDEX_NAME
),
fks_reales AS (
 SELECT k.TABLE_NAME tabla,k.CONSTRAINT_NAME nombre,
 GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas,
 MAX(k.REFERENCED_TABLE_NAME) padre,MAX(k.REFERENCED_TABLE_SCHEMA) esquema_padre,
 GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_padre,
 MAX(r.UPDATE_RULE) regla_update,MAX(r.DELETE_RULE) regla_delete
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() GROUP BY k.TABLE_NAME,k.CONSTRAINT_NAME
),
objetos AS (
 SELECT e.ambito,CONCAT('columna:',e.nombre) objeto,(c.COLUMN_NAME IS NOT NULL) presente,
 COALESCE(c.DATA_TYPE=e.tipo AND c.IS_NULLABLE='YES' AND (c.COLUMN_DEFAULT IS NULL OR c.COLUMN_DEFAULT='NULL')
 AND c.EXTRA='' AND c.COLUMN_TYPE NOT LIKE '%unsigned%'
 AND (e.longitud IS NULL OR c.CHARACTER_MAXIMUM_LENGTH=e.longitud)
 AND (e.tipo NOT IN ('varchar','char','longtext') OR (c.CHARACTER_SET_NAME='utf8mb4'
   AND c.COLLATION_NAME=IF(e.binaria=1,'utf8mb4_bin',t.TABLE_COLLATION)))
 AND (e.tipo<>'tinyint' OR c.COLUMN_TYPE='tinyint(1)')
 AND (e.es_json=0 OR EXISTS(SELECT 1 FROM information_schema.CHECK_CONSTRAINTS ck
   WHERE ck.CONSTRAINT_SCHEMA=DATABASE() AND ck.TABLE_NAME=e.tabla
   AND REGEXP_REPLACE(REPLACE(LOWER(ck.CHECK_CLAUSE),CHAR(96),''),'[[:space:]]','')=CONCAT('json_valid(',e.nombre,')'))),0) correcto
 FROM columnas_esperadas e LEFT JOIN information_schema.COLUMNS c
 ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.nombre
 LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=e.tabla
 UNION ALL
 SELECT e.ambito,CONCAT('indice:',e.nombre),r.nombre IS NOT NULL,
 COALESCE(r.columnas=e.columnas AND r.no_unico=e.no_unico AND r.prefijos=0 AND r.incompatibles=0,0)
 FROM indices_esperados e LEFT JOIN indices_reales r ON r.tabla=e.tabla AND r.nombre=e.nombre
 UNION ALL
 SELECT e.ambito,CONCAT('fk:',e.nombre),
 EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS tc WHERE tc.CONSTRAINT_SCHEMA=DATABASE() AND tc.CONSTRAINT_NAME=e.nombre),
 COALESCE(r.columnas=e.columnas AND r.padre=e.padre AND r.columnas_padre=e.columnas_padre
 AND r.esquema_padre=DATABASE() AND r.regla_update='RESTRICT' AND r.regla_delete='RESTRICT',0)
 FROM fks_esperadas e LEFT JOIN fks_reales r ON r.tabla=e.tabla AND r.nombre=e.nombre
),
conteos AS (
 SELECT SUM(ambito='H' AND presente) hp,SUM(ambito='H' AND correcto) hc,
 SUM(ambito='F' AND presente) fp,SUM(ambito='F' AND correcto) fc FROM objetos
),
base AS (
 SELECT (DATABASE() IS NOT NULL AND VERSION() LIKE '11.8.%MariaDB%'
 AND @@foreign_key_checks=1 AND @@check_constraint_checks=1
 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
   AND TABLE_NAME IN ('empresas','usuarios','compras_proveedores','flota_combustible_conciliaciones','flota_combustible_conciliacion_filas','auditoria') AND ENGINE='InnoDB')=6
 AND (SELECT COUNT(*) FROM ids_base e JOIN information_schema.COLUMNS c
   ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.nombre
   WHERE c.DATA_TYPE='int' AND c.COLUMN_TYPE NOT LIKE '%unsigned%' AND c.IS_NULLABLE='NO')=9
 AND (SELECT COUNT(*) FROM indices_reales WHERE tabla IN ('empresas','usuarios','compras_proveedores','flota_combustible_conciliaciones','flota_combustible_conciliacion_filas')
   AND nombre='PRIMARY' AND columnas='id' AND no_unico=0 AND prefijos=0 AND incompatibles=0)=5
 AND EXISTS(SELECT 1 FROM indices_reales WHERE tabla='compras_proveedores' AND columnas='empresa_id,id' AND no_unico=0 AND prefijos=0 AND incompatibles=0)) ok
)
SELECT CASE WHEN NOT base.ok THEN 'DIVERGENTE'
 WHEN hp=0 AND fp=0 THEN 'CLEAN'
 WHEN hp=14 AND hc=14 AND fp=0 THEN 'PARTIAL_HEADER_COMPLETE'
 WHEN hp=14 AND hc=14 AND fp=16 AND fc=16 THEN 'FINAL'
 ELSE 'DIVERGENTE' END,hp,hc,fp,fc
INTO @c2b_estado,@c2b_h_presentes,@c2b_h_correctos,@c2b_f_presentes,@c2b_f_correctos
FROM conteos CROSS JOIN base;
-- END C2B CONTRACT AUDIT
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
SELECT CASE WHEN NOT base.ok OR COALESCE(@c2b_estado,'')<>'FINAL' THEN 'DIVERGENTE'
 WHEN conteos.presentes=0 AND NOT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_conciliacion_filas'
   AND INDEX_NAME IN ('fk_fccif_vinculo','fk_fccif_sugerida','fk_fccif_confirmo')) THEN 'CLEAN'
 WHEN conteos.esperados=18 AND conteos.presentes=18 AND conteos.correctos=18 THEN 'FINAL'
 ELSE 'DIVERGENTE' END,conteos.esperados,conteos.presentes,conteos.correctos
INTO @c2c_estado,@c2c_esperados,@c2c_presentes,@c2c_correctos
FROM conteos CROSS JOIN base;
-- END C2C CONTRACT AUDIT
DELIMITER $$
BEGIN NOT ATOMIC
 DECLARE n_filas,n_cabeceras,n_cargas,n_usuarios BIGINT;
 IF @c2c_estado IS NULL OR @c2c_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: la auditoria posterior al DDL no certifica FINAL';
 END IF;
 SELECT (SELECT COUNT(*) FROM flota_combustible_conciliacion_filas),(SELECT COUNT(*) FROM flota_combustible_conciliaciones),
  (SELECT COUNT(*) FROM flota_combustible_cargas),(SELECT COUNT(*) FROM usuarios) INTO n_filas,n_cabeceras,n_cargas,n_usuarios;
 IF NOT (n_filas<=>@c2c_n_filas AND n_cabeceras<=>@c2c_n_cabeceras AND n_cargas<=>@c2c_n_cargas AND n_usuarios<=>@c2c_n_usuarios) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: los conteos antes/despues difieren (no debe haber DML)';
 END IF;
END$$
DELIMITER ;
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@c2c_inicial estado_inicial,@c2c_estado estado_final,
 IF(@c2c_inicial='CLEAN','APLICADO','NOOP') resultado,@c2c_presentes objetos_presentes,@c2c_correctos objetos_correctos,
 @c2c_n_filas filas_antes,@c2c_n_cargas vales_antes;

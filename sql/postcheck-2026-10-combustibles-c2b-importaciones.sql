-- POSTCHECK SOLO LECTURA, metadata/datos y variables de sesión. Sin PROCESS.
-- Certifica todos los objetos, ceros huérfanos y canónicas inválidas.
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
-- BEGIN C2B DATA AUDIT (solo lecturas; SQL dinámico evita mencionar columnas aún ausentes)
DELIMITER $$
BEGIN NOT ATOMIC
 SELECT COUNT(*) INTO @c2b_huerfanos_cabecera FROM flota_combustible_conciliaciones c
 LEFT JOIN empresas e ON e.id=c.empresa_id WHERE e.id IS NULL;
 SELECT COUNT(*) INTO @c2b_huerfanos_filas FROM flota_combustible_conciliacion_filas f
 LEFT JOIN flota_combustible_conciliaciones c ON c.empresa_id=f.empresa_id AND c.id=f.conciliacion_id WHERE c.id IS NULL;
 SELECT NULL,NULL INTO @c2b_refs_cabecera,@c2b_canonicas_invalidas;
 SELECT COUNT(*) INTO @c2b_legacy_h FROM flota_combustible_conciliaciones;
 SELECT COUNT(*) INTO @c2b_legacy_f FROM flota_combustible_conciliacion_filas;
 IF @c2b_h_correctos=14 THEN
  SET @c2b_lectura='SELECT COUNT(*) INTO @c2b_refs_cabecera FROM flota_combustible_conciliaciones c LEFT JOIN compras_proveedores p ON p.empresa_id=c.empresa_id AND p.id=c.proveedor_id LEFT JOIN usuarios u ON u.id=c.subido_por_usuario_id WHERE (c.proveedor_id IS NOT NULL AND p.id IS NULL) OR (c.subido_por_usuario_id IS NOT NULL AND u.id IS NULL)';
  PREPARE c2b_read FROM @c2b_lectura; EXECUTE c2b_read; DEALLOCATE PREPARE c2b_read;
  SET @c2b_lectura='SELECT COUNT(*) INTO @c2b_legacy_h FROM flota_combustible_conciliaciones WHERE perfil_parser IS NULL';
  PREPARE c2b_read FROM @c2b_lectura; EXECUTE c2b_read; DEALLOCATE PREPARE c2b_read;
 END IF;
 IF @c2b_f_correctos=16 THEN
  SET @c2b_lectura='SELECT COUNT(*) INTO @c2b_canonicas_invalidas FROM flota_combustible_conciliacion_filas f LEFT JOIN flota_combustible_conciliacion_filas p ON p.empresa_id=f.empresa_id AND p.conciliacion_id=f.conciliacion_id AND p.id=f.duplicado_de_linea_id WHERE (f.duplicado_de_linea_id IS NOT NULL AND (p.id IS NULL OR p.id>=f.id OR p.duplicado_de_linea_id IS NOT NULL OR NOT(p.fingerprint <=> f.fingerprint) OR NOT(f.duplicado_tipo <=> ''EXACTO''))) OR (f.duplicado_tipo=''EXACTO'' AND f.duplicado_de_linea_id IS NULL)';
  PREPARE c2b_read FROM @c2b_lectura; EXECUTE c2b_read; DEALLOCATE PREPARE c2b_read;
  SET @c2b_lectura='SELECT COUNT(*) INTO @c2b_legacy_f FROM flota_combustible_conciliacion_filas WHERE estado_parseo IS NULL';
  PREPARE c2b_read FROM @c2b_lectura; EXECUTE c2b_read; DEALLOCATE PREPARE c2b_read;
 END IF;
 IF COALESCE(@c2b_huerfanos_cabecera,0)+COALESCE(@c2b_huerfanos_filas,0)+COALESCE(@c2b_refs_cabecera,0)+COALESCE(@c2b_canonicas_invalidas,0)>0 THEN
  SELECT 'DIVERGENTE' INTO @c2b_estado;
 END IF;
END$$
DELIMITER ;
-- END C2B DATA AUDIT
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@c2b_estado estado_c2b,
 @c2b_h_presentes objetos_cabecera,@c2b_h_correctos correctos_cabecera,
 @c2b_f_presentes objetos_filas,@c2b_f_correctos correctos_filas,
 @c2b_huerfanos_cabecera huerfanos_cabecera,@c2b_refs_cabecera referencias_cabecera_invalidas,
 @c2b_huerfanos_filas huerfanos_filas,@c2b_canonicas_invalidas canonicas_invalidas,
 @c2b_legacy_h cabeceras_legacy,@c2b_legacy_f filas_legacy;

DELIMITER $$
BEGIN NOT ATOMIC
 IF @c2b_estado IS NULL OR @c2b_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: postcheck C2B no FINAL';
 END IF;
END$$
DELIMITER ;
SELECT CASE WHEN @c2b_antes_h IS NULL OR @c2b_antes_f IS NULL OR @c2b_antes_bd IS NULL OR @c2b_antes_bd<>DATABASE() THEN 'COMPARAR_CON_PREFLIGHT_GUARDADO'
 WHEN @c2b_legacy_h=@c2b_antes_h AND @c2b_legacy_f=@c2b_antes_f THEN 'LEGACY_PRESERVADO'
 ELSE 'DETENER_CONTEOS_CAMBIARON' END preservacion_legacy;
SHOW CREATE TABLE flota_combustible_conciliaciones;
SHOW CREATE TABLE flota_combustible_conciliacion_filas;
-- Si phpMyAdmin abre otra conexión, comparar manualmente conteos con el preflight guardado.
-- El migrate ya verifica antes/después en su propia sesión; ninguna certificación inventada entre sesiones.

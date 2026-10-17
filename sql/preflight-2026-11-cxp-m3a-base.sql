-- CXP M-3A - PREFLIGHT (SOLO LECTURA). NO ejecutado por la rama. Estandar contractual CLEAN | FINAL | DIVERGENTE.
-- Esperado antes de migrar: estado_cxp_rollout = CLEAN. FINAL = ya aplicado (migrate sera NOOP). DIVERGENTE = DETENER.
-- Misma sesion; sin escrituras/DDL concurrentes. Se GENERA con scripts/generar-sql-cxp-m3a.py (no editar a mano).
-- BEGIN CXP M3A CONTRACT AUDIT (identico en preflight/migrate/postcheck; SELECT INTO solo asigna variables de sesion)
SELECT NULL,NULL,NULL,NULL INTO @cxp_estado,@cxp_esperados,@cxp_presentes,@cxp_correctos;
WITH
tablas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_proveedor_fiscal"],["cxp_facturas"]]','$[*]' COLUMNS(nombre VARCHAR(64) PATH '$[0]')) j
),
columnas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_proveedor_fiscal","empresa_id","int","int(11)",0,null,"",null,0],["cxp_proveedor_fiscal","entidad_id","int","int(11)",0,null,"",null,0],["cxp_proveedor_fiscal","proveedor_id","int","int(11)",0,null,"",null,0],["cxp_proveedor_fiscal","regimen_fiscal","varchar","varchar(30)",0,null,"",null,1],["cxp_proveedor_fiscal","sujeto_isr","tinyint","tinyint(1)",0,null,"",null,0],["cxp_proveedor_fiscal","cuenta_proveedor_id","int","int(11)",1,null,"",null,0],["cxp_proveedor_fiscal","cuenta_anticipo_id","int","int(11)",1,null,"",null,0],["cxp_proveedor_fiscal","cuenta_gasto_id","int","int(11)",1,null,"",null,0],["cxp_proveedor_fiscal","activo","tinyint","tinyint(1)",0,"1","",null,0],["cxp_proveedor_fiscal","creado_por","int","int(11)",0,null,"",null,0],["cxp_proveedor_fiscal","creado_en","datetime","datetime",0,"current_timestamp()","",null,0],["cxp_proveedor_fiscal","actualizado_por","int","int(11)",0,null,"",null,0],["cxp_proveedor_fiscal","actualizado_en","datetime","datetime",0,"current_timestamp()","on update current_timestamp()",null,0],["cxp_facturas","id","int","int(11)",0,null,"auto_increment",null,0],["cxp_facturas","empresa_id","int","int(11)",0,null,"",null,0],["cxp_facturas","entidad_id","int","int(11)",0,null,"",null,0],["cxp_facturas","proveedor_id","int","int(11)",0,null,"",null,0],["cxp_facturas","tipo_documento","varchar","varchar(20)",0,null,"",null,1],["cxp_facturas","serie","varchar","varchar(40)",0,"''''","",null,1],["cxp_facturas","numero","varchar","varchar(60)",0,null,"",null,1],["cxp_facturas","serie_norm","varchar","varchar(40)",0,"''''","",null,1],["cxp_facturas","numero_norm","varchar","varchar(60)",0,null,"",null,1],["cxp_facturas","fecha_documento","date","date",0,null,"",null,0],["cxp_facturas","fecha_vencimiento","date","date",1,null,"",null,0],["cxp_facturas","base_neto","decimal","decimal(14,2)",0,null,"",null,0],["cxp_facturas","iva_monto","decimal","decimal(14,2)",0,"0.00","",null,0],["cxp_facturas","total_documento","decimal","decimal(14,2)",0,null,"",null,0],["cxp_facturas","isr_porcentaje","decimal","decimal(5,2)",0,"0.00","",null,0],["cxp_facturas","isr_monto","decimal","decimal(14,2)",0,"0.00","",null,0],["cxp_facturas","total_neto_pagar","decimal","decimal(14,2)",0,null,"",null,0],["cxp_facturas","regla_isr","varchar","varchar(60)",0,null,"",null,1],["cxp_facturas","regimen_fiscal_snapshot","varchar","varchar(30)",0,null,"",null,1],["cxp_facturas","sujeto_isr_snapshot","tinyint","tinyint(1)",0,null,"",null,0],["cxp_facturas","observaciones","varchar","varchar(500)",1,null,"",null,1],["cxp_facturas","estado_admin","varchar","varchar(12)",0,"''REGISTRADA''","",null,1],["cxp_facturas","creado_por","int","int(11)",0,null,"",null,0],["cxp_facturas","creado_en","datetime","datetime",0,"current_timestamp()","",null,0],["cxp_facturas","anulado_por","int","int(11)",1,null,"",null,0],["cxp_facturas","anulado_en","datetime","datetime",1,null,"",null,0],["cxp_facturas","motivo_anulacion","varchar","varchar(500)",1,null,"",null,1]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', tipo VARCHAR(20) PATH '$[2]', tipo_col VARCHAR(30) PATH '$[3]',
  nulo INT PATH '$[4]', defecto VARCHAR(100) PATH '$[5]', extra VARCHAR(40) PATH '$[6]', gen VARCHAR(200) PATH '$[7]', texto INT PATH '$[8]')) j
),
indices_esperados AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_proveedor_fiscal","PRIMARY","empresa_id,entidad_id,proveedor_id",0],["cxp_proveedor_fiscal","idx_cxppf_proveedor","empresa_id,proveedor_id",1],["cxp_facturas","PRIMARY","id",0],["cxp_facturas","uq_cxpf_documento","empresa_id,proveedor_id,serie_norm,numero_norm",0],["cxp_facturas","uq_cxpf_ambito","empresa_id,entidad_id,id",0],["cxp_facturas","idx_cxpf_listado","empresa_id,entidad_id,estado_admin,fecha_documento",1],["cxp_facturas","idx_cxpf_proveedor","empresa_id,entidad_id,proveedor_id,fecha_documento",1]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', columnas VARCHAR(255) PATH '$[2]', no_unico INT PATH '$[3]')) j
),
checks_esperados AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_proveedor_fiscal","ck_cxppf_regimen","regimen_fiscalin(''GENERAL'',''PEQUENO_CONTRIBUYENTE'')"],["cxp_proveedor_fiscal","ck_cxppf_isr","sujeto_isrin(0,1)"],["cxp_proveedor_fiscal","ck_cxppf_activo","activoin(0,1)"],["cxp_proveedor_fiscal","ck_cxppf_pequeno","regimen_fiscal<>''PEQUENO_CONTRIBUYENTE''orsujeto_isr=0"],["cxp_facturas","ck_cxpf_tipo","tipo_documentoin(''FACTURA'',''FACTURA_ESPECIAL'')"],["cxp_facturas","ck_cxpf_estado","estado_adminin(''REGISTRADA'',''ANULADA'')"],["cxp_facturas","ck_cxpf_numero","char_length(numero_norm)>0"],["cxp_facturas","ck_cxpf_importes","base_neto>0andiva_monto>=0andisr_monto>=0andisr_porcentaje>=0"],["cxp_facturas","ck_cxpf_total","total_documento=base_neto+iva_monto"],["cxp_facturas","ck_cxpf_neto","total_neto_pagar=total_documento-isr_montoandtotal_neto_pagar>=0"],["cxp_facturas","ck_cxpf_regimen","regimen_fiscal_snapshotin(''GENERAL'',''PEQUENO_CONTRIBUYENTE'')andsujeto_isr_snapshotin(0,1)"],["cxp_facturas","ck_cxpf_pequeno","regimen_fiscal_snapshot<>''PEQUENO_CONTRIBUYENTE''orsujeto_isr_snapshot=0"],["cxp_facturas","ck_cxpf_isr_sujeto","sujeto_isr_snapshot=1orisr_monto=0"],["cxp_facturas","ck_cxpf_vencimiento","fecha_vencimientoisnullorfecha_vencimiento>=fecha_documento"],["cxp_facturas","ck_cxpf_anulacion","estado_admin=''REGISTRADA''andanulado_porisnullandanulado_enisnullandmotivo_anulacionisnullorestado_admin=''ANULADA''andanulado_porisnotnullandanulado_enisnotnullandmotivo_anulacionisnotnullandchar_length(trim(motivo_anulacion))>0"]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', clausula VARCHAR(1000) PATH '$[2]')) j
),
fks_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_proveedor_fiscal","fk_cxppf_entidad","empresa_id,entidad_id","cont_entidades","empresa_id,id"],["cxp_proveedor_fiscal","fk_cxppf_proveedor","empresa_id,proveedor_id","compras_proveedores","empresa_id,id"],["cxp_proveedor_fiscal","fk_cxppf_cta_proveedor","empresa_id,entidad_id,cuenta_proveedor_id","cont_cuentas","empresa_id,entidad_id,id"],["cxp_proveedor_fiscal","fk_cxppf_cta_anticipo","empresa_id,entidad_id,cuenta_anticipo_id","cont_cuentas","empresa_id,entidad_id,id"],["cxp_proveedor_fiscal","fk_cxppf_cta_gasto","empresa_id,entidad_id,cuenta_gasto_id","cont_cuentas","empresa_id,entidad_id,id"],["cxp_proveedor_fiscal","fk_cxppf_creador","creado_por","usuarios","id"],["cxp_proveedor_fiscal","fk_cxppf_editor","actualizado_por","usuarios","id"],["cxp_facturas","fk_cxpf_fiscal","empresa_id,entidad_id,proveedor_id","cxp_proveedor_fiscal","empresa_id,entidad_id,proveedor_id"],["cxp_facturas","fk_cxpf_creador","creado_por","usuarios","id"],["cxp_facturas","fk_cxpf_anulador","anulado_por","usuarios","id"]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', columnas VARCHAR(255) PATH '$[2]', padre VARCHAR(64) PATH '$[3]', columnas_padre VARCHAR(255) PATH '$[4]')) j
),
indices_reales AS (
 SELECT TABLE_NAME tabla, INDEX_NAME nombre, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas, MAX(NON_UNIQUE) no_unico,
 SUM(SUB_PART IS NOT NULL) prefijos, SUM(INDEX_TYPE<>'BTREE' OR COLLATION<>'A' OR IGNORED<>'NO') incompatibles
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('cxp_proveedor_fiscal','cxp_facturas') GROUP BY TABLE_NAME,INDEX_NAME
),
fks_reales AS (
 SELECT k.TABLE_NAME tabla, k.CONSTRAINT_NAME nombre, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas,
 MAX(k.REFERENCED_TABLE_NAME) padre, MAX(k.REFERENCED_TABLE_SCHEMA) esquema_padre,
 GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_padre, MAX(r.UPDATE_RULE) regla_update, MAX(r.DELETE_RULE) regla_delete
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME IN ('cxp_proveedor_fiscal','cxp_facturas') AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME,k.CONSTRAINT_NAME
),
objetos AS (
 SELECT CONCAT('tabla:',e.nombre) objeto,(t.TABLE_NAME IS NOT NULL) presente,
 COALESCE(t.ENGINE='InnoDB' AND t.TABLE_COLLATION='utf8mb4_uca1400_ai_ci',0) correcto
 FROM tablas_esperadas e LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=e.nombre
 UNION ALL
 SELECT CONCAT('columna:',e.tabla,'.',e.nombre),(c.COLUMN_NAME IS NOT NULL),
 COALESCE(c.DATA_TYPE=e.tipo AND c.COLUMN_TYPE=e.tipo_col AND (c.IS_NULLABLE='YES')=(e.nulo=1)
 AND ((e.defecto IS NULL AND (c.COLUMN_DEFAULT IS NULL OR c.COLUMN_DEFAULT='NULL')) OR c.COLUMN_DEFAULT=e.defecto)
 AND c.EXTRA=e.extra AND COALESCE(c.GENERATION_EXPRESSION,'')=COALESCE(e.gen,'')
 AND IF(e.texto=1,c.CHARACTER_SET_NAME='utf8mb4' AND c.COLLATION_NAME='utf8mb4_uca1400_ai_ci',c.CHARACTER_SET_NAME IS NULL),0)
 FROM columnas_esperadas e LEFT JOIN information_schema.COLUMNS c
 ON c.TABLE_SCHEMA=DATABASE() AND c.TABLE_NAME=e.tabla AND c.COLUMN_NAME=e.nombre
 UNION ALL
 SELECT CONCAT('indice:',e.tabla,'.',e.nombre),(r.nombre IS NOT NULL),
 COALESCE(r.columnas=e.columnas AND r.no_unico=e.no_unico AND r.prefijos=0 AND r.incompatibles=0,0)
 FROM indices_esperados e LEFT JOIN indices_reales r ON r.tabla=e.tabla AND r.nombre=e.nombre
 UNION ALL
 SELECT CONCAT('check:',e.tabla,'.',e.nombre),(ck.CONSTRAINT_NAME IS NOT NULL),
 COALESCE(REGEXP_REPLACE(REPLACE(ck.CHECK_CLAUSE,CHAR(96),''),'[[:space:]]','')=e.clausula,0)
 FROM checks_esperados e LEFT JOIN information_schema.CHECK_CONSTRAINTS ck
 ON ck.CONSTRAINT_SCHEMA=DATABASE() AND ck.TABLE_NAME=e.tabla AND ck.CONSTRAINT_NAME=e.nombre
 UNION ALL
 SELECT CONCAT('fk:',e.tabla,'.',e.nombre),(r.nombre IS NOT NULL),
 COALESCE(r.columnas=e.columnas AND r.padre=e.padre AND r.columnas_padre=e.columnas_padre AND r.esquema_padre=DATABASE()
 AND r.regla_update='RESTRICT' AND r.regla_delete='RESTRICT',0)
 FROM fks_esperadas e LEFT JOIN fks_reales r ON r.tabla=e.tabla AND r.nombre=e.nombre
),
conteos AS (SELECT COUNT(*) esperados,SUM(presente) presentes,SUM(correcto) correctos FROM objetos),
base AS (
 SELECT (DATABASE() IS NOT NULL AND VERSION() LIKE '11.8.%MariaDB%' AND @@foreign_key_checks=1 AND @@check_constraint_checks=1
 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
   AND TABLE_NAME IN ('usuarios','compras_proveedores','cont_entidades','cont_cuentas') AND ENGINE='InnoDB')=4
 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE='int' AND COLUMN_TYPE='int(11)'
   AND ((TABLE_NAME='usuarios' AND COLUMN_NAME='id' AND IS_NULLABLE='NO')
     OR (TABLE_NAME='compras_proveedores' AND COLUMN_NAME IN ('id','empresa_id') AND IS_NULLABLE='NO')
     OR (TABLE_NAME='cont_entidades' AND COLUMN_NAME IN ('id','empresa_id') AND IS_NULLABLE='NO')
     OR (TABLE_NAME='cont_cuentas' AND COLUMN_NAME IN ('id','empresa_id') AND IS_NULLABLE='NO')
     OR (TABLE_NAME='cont_cuentas' AND COLUMN_NAME='entidad_id')))=8
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuarios' AND INDEX_NAME='PRIMARY' AND COLUMN_NAME='id')
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='compras_proveedores' AND NON_UNIQUE=0
   GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,id' LIMIT 1)
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_entidades' AND NON_UNIQUE=0
   GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,id' LIMIT 1)
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_cuentas' AND NON_UNIQUE=0
   GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,entidad_id,id' LIMIT 1)) ok
)
SELECT CASE WHEN NOT base.ok THEN 'DIVERGENTE'
 WHEN conteos.presentes=0 THEN 'CLEAN'
 WHEN conteos.esperados=74 AND conteos.presentes=74 AND conteos.correctos=74 THEN 'FINAL'
 ELSE 'DIVERGENTE' END,conteos.esperados,conteos.presentes,conteos.correctos
INTO @cxp_estado,@cxp_esperados,@cxp_presentes,@cxp_correctos
FROM conteos CROSS JOIN base;
-- END CXP M3A CONTRACT AUDIT
SELECT (SELECT COUNT(*) FROM cont_cxp),(SELECT COUNT(*) FROM compras_proveedores),(SELECT COUNT(*) FROM cont_entidades),
 (SELECT COUNT(*) FROM cont_cuentas),(SELECT COUNT(*) FROM usuarios)
INTO @cxp_n_legacy,@cxp_n_proveedores,@cxp_n_entidades,@cxp_n_cuentas,@cxp_n_usuarios;
-- BEGIN CXP M3A DATA AUDIT (solo lecturas; SQL dinamico para no mencionar tablas aun ausentes)
SELECT NULL,NULL INTO @cxp_n_config,@cxp_n_facturas;
DELIMITER $$
BEGIN NOT ATOMIC
 IF @cxp_estado='FINAL' THEN
  SET @cxp_lectura='SELECT (SELECT COUNT(*) FROM cxp_proveedor_fiscal),(SELECT COUNT(*) FROM cxp_facturas) INTO @cxp_n_config,@cxp_n_facturas';
  PREPARE cxp_read FROM @cxp_lectura; EXECUTE cxp_read; DEALLOCATE PREPARE cxp_read;
 END IF;
END$$
DELIMITER ;
-- END CXP M3A DATA AUDIT
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@cxp_estado estado_cxp_rollout,@cxp_esperados objetos_esperados,@cxp_presentes objetos_presentes,@cxp_correctos objetos_correctos,
 @cxp_n_legacy filas_cont_cxp_legacy,@cxp_n_proveedores proveedores,@cxp_n_config configuraciones_fiscales,@cxp_n_facturas facturas_cxp;

-- CXP M-3B1 (pagos) - POSTCHECK (SOLO LECTURA). Exige FINAL y FALLA (SIGNAL) si cualquier conteo de integridad es > 0; siempre los muestra.
-- Verifica: pagos = suma de aplicaciones, mismo proveedor pago/factura, sin pagos vigentes sobre facturas anuladas, sin sobreaplicacion, y que el ISR de
-- cada factura M3B1_V1 coincida con el tramo confirmado y su redondeo a 2 decimales (mitad hacia arriba; ROUND de MariaDB sobre DECIMAL redondea .5 alejandose de cero) (el postcheck de M-3A solo conoce 5 %, por eso este es el vigente cuando existan facturas M3B1_V1).
-- Se GENERA con scripts/generar-sql-cxp-m3b1.py (no editar a mano).
-- BEGIN CXP M3B1 CONTRACT AUDIT (identico en preflight/migrate/postcheck/rollback; SELECT INTO solo asigna variables de sesion)
SELECT NULL,NULL,NULL,NULL INTO @cxpp_estado,@cxpp_esperados,@cxpp_presentes,@cxpp_correctos;
WITH
tablas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_pagos"],["cxp_pago_aplicaciones"]]','$[*]' COLUMNS(nombre VARCHAR(64) PATH '$[0]')) j
),
columnas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_pagos","id","int","int(11)",0,null,"auto_increment",null,0],["cxp_pagos","empresa_id","int","int(11)",0,null,"",null,0],["cxp_pagos","entidad_id","int","int(11)",0,null,"",null,0],["cxp_pagos","proveedor_id","int","int(11)",0,null,"",null,0],["cxp_pagos","fecha_pago","date","date",0,null,"",null,0],["cxp_pagos","monto_total","decimal","decimal(14,2)",0,null,"",null,0],["cxp_pagos","medio_pago","varchar","varchar(40)",0,"''''","",null,1],["cxp_pagos","referencia","varchar","varchar(120)",0,"''''","",null,1],["cxp_pagos","observaciones","varchar","varchar(500)",1,null,"",null,1],["cxp_pagos","clave_idempotencia","varchar","varchar(64)",0,null,"",null,1],["cxp_pagos","huella","char","char(64)",0,null,"",null,1],["cxp_pagos","estado","varchar","varchar(10)",0,"''REGISTRADO''","",null,1],["cxp_pagos","creado_por","int","int(11)",0,null,"",null,0],["cxp_pagos","creado_en","datetime","datetime",0,"current_timestamp()","",null,0],["cxp_pagos","reversado_por","int","int(11)",1,null,"",null,0],["cxp_pagos","reversado_en","datetime","datetime",1,null,"",null,0],["cxp_pagos","motivo_reversion","varchar","varchar(500)",1,null,"",null,1],["cxp_pago_aplicaciones","id","int","int(11)",0,null,"auto_increment",null,0],["cxp_pago_aplicaciones","empresa_id","int","int(11)",0,null,"",null,0],["cxp_pago_aplicaciones","entidad_id","int","int(11)",0,null,"",null,0],["cxp_pago_aplicaciones","pago_id","int","int(11)",0,null,"",null,0],["cxp_pago_aplicaciones","factura_id","int","int(11)",0,null,"",null,0],["cxp_pago_aplicaciones","monto","decimal","decimal(14,2)",0,null,"",null,0]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', tipo VARCHAR(20) PATH '$[2]', tipo_col VARCHAR(30) PATH '$[3]',
  nulo INT PATH '$[4]', defecto VARCHAR(100) PATH '$[5]', extra VARCHAR(40) PATH '$[6]', gen VARCHAR(200) PATH '$[7]', texto INT PATH '$[8]')) j
),
indices_esperados AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_pagos","PRIMARY","id",0],["cxp_pagos","uq_cxpp_ambito","empresa_id,entidad_id,id",0],["cxp_pagos","uq_cxpp_clave","empresa_id,entidad_id,clave_idempotencia",0],["cxp_pagos","idx_cxpp_listado","empresa_id,entidad_id,estado,fecha_pago",1],["cxp_pagos","idx_cxpp_proveedor","empresa_id,entidad_id,proveedor_id,fecha_pago",1],["cxp_pago_aplicaciones","PRIMARY","id",0],["cxp_pago_aplicaciones","uq_cxpa_pago_factura","empresa_id,entidad_id,pago_id,factura_id",0],["cxp_pago_aplicaciones","idx_cxpa_factura","empresa_id,entidad_id,factura_id",1]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', columnas VARCHAR(255) PATH '$[2]', no_unico INT PATH '$[3]')) j
),
checks_esperados AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_pagos","ck_cxpp_monto","monto_total>0"],["cxp_pagos","ck_cxpp_estado","estadoin(''REGISTRADO'',''REVERSADO'')"],["cxp_pagos","ck_cxpp_clave","char_length(clave_idempotencia)>=8"],["cxp_pagos","ck_cxpp_reversion","estado=''REGISTRADO''andreversado_porisnullandreversado_enisnullandmotivo_reversionisnullorestado=''REVERSADO''andreversado_porisnotnullandreversado_enisnotnullandmotivo_reversionisnotnullandchar_length(trim(motivo_reversion))>0"],["cxp_pago_aplicaciones","ck_cxpa_monto","monto>0"]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', clausula VARCHAR(1000) PATH '$[2]')) j
),
fks_esperadas AS (
 SELECT j.* FROM JSON_TABLE('[["cxp_pagos","fk_cxpp_fiscal","empresa_id,entidad_id,proveedor_id","cxp_proveedor_fiscal","empresa_id,entidad_id,proveedor_id"],["cxp_pagos","fk_cxpp_creador","creado_por","usuarios","id"],["cxp_pagos","fk_cxpp_reversor","reversado_por","usuarios","id"],["cxp_pago_aplicaciones","fk_cxpa_pago","empresa_id,entidad_id,pago_id","cxp_pagos","empresa_id,entidad_id,id"],["cxp_pago_aplicaciones","fk_cxpa_factura","empresa_id,entidad_id,factura_id","cxp_facturas","empresa_id,entidad_id,id"]]','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', columnas VARCHAR(255) PATH '$[2]', padre VARCHAR(64) PATH '$[3]', columnas_padre VARCHAR(255) PATH '$[4]')) j
),
indices_reales AS (
 SELECT TABLE_NAME tabla, INDEX_NAME nombre, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas, MAX(NON_UNIQUE) no_unico,
 SUM(SUB_PART IS NOT NULL) prefijos, SUM(INDEX_TYPE<>'BTREE' OR COLLATION<>'A' OR IGNORED<>'NO') incompatibles
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('cxp_pagos','cxp_pago_aplicaciones') GROUP BY TABLE_NAME,INDEX_NAME
),
fks_reales AS (
 SELECT k.TABLE_NAME tabla, k.CONSTRAINT_NAME nombre, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas,
 MAX(k.REFERENCED_TABLE_NAME) padre, MAX(k.REFERENCED_TABLE_SCHEMA) esquema_padre,
 GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_padre, MAX(r.UPDATE_RULE) regla_update, MAX(r.DELETE_RULE) regla_delete
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME IN ('cxp_pagos','cxp_pago_aplicaciones') AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME,k.CONSTRAINT_NAME
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
 -- Prerrequisito: M-3A aplicada (cxp_proveedor_fiscal con su PK de ambito y cxp_facturas con uq_cxpf_ambito), usuarios y MariaDB 11.8.
 SELECT (DATABASE() IS NOT NULL AND VERSION() LIKE '11.8.%MariaDB%' AND @@foreign_key_checks=1 AND @@check_constraint_checks=1
 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
   AND TABLE_NAME IN ('usuarios','cxp_proveedor_fiscal','cxp_facturas') AND ENGINE='InnoDB')=3
 AND (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND DATA_TYPE='int' AND COLUMN_TYPE='int(11)'
   AND ((TABLE_NAME='usuarios' AND COLUMN_NAME='id' AND IS_NULLABLE='NO')
     OR (TABLE_NAME='cxp_proveedor_fiscal' AND COLUMN_NAME IN ('empresa_id','entidad_id','proveedor_id') AND IS_NULLABLE='NO')
     OR (TABLE_NAME='cxp_facturas' AND COLUMN_NAME IN ('id','empresa_id','entidad_id') AND IS_NULLABLE='NO')))=7
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='usuarios' AND INDEX_NAME='PRIMARY' AND COLUMN_NAME='id')
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cxp_proveedor_fiscal' AND NON_UNIQUE=0
   GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,entidad_id,proveedor_id' LIMIT 1)
 AND EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cxp_facturas' AND NON_UNIQUE=0
   GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,entidad_id,id' LIMIT 1)) ok
)
SELECT CASE WHEN NOT base.ok THEN 'DIVERGENTE'
 WHEN conteos.presentes=0 THEN 'CLEAN'
 WHEN conteos.esperados=43 AND conteos.presentes=43 AND conteos.correctos=43 THEN 'FINAL'
 ELSE 'DIVERGENTE' END,conteos.esperados,conteos.presentes,conteos.correctos
INTO @cxpp_estado,@cxpp_esperados,@cxpp_presentes,@cxpp_correctos
FROM conteos CROSS JOIN base;
-- END CXP M3B1 CONTRACT AUDIT
-- Conteos de tablas M-3A/usuarios (SQL dinamico: si M-3A no esta aplicada, el estado es DIVERGENTE y no se mencionan tablas ausentes)
SELECT NULL,NULL,NULL INTO @cxpp_n_config,@cxpp_n_facturas,@cxpp_n_usuarios;
DELIMITER $$
BEGIN NOT ATOMIC
 IF (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('cxp_proveedor_fiscal','cxp_facturas'))=2 THEN
  SET @cxpp_conteo='SELECT (SELECT COUNT(*) FROM cxp_proveedor_fiscal),(SELECT COUNT(*) FROM cxp_facturas),(SELECT COUNT(*) FROM usuarios) INTO @cxpp_n_config,@cxpp_n_facturas,@cxpp_n_usuarios';
  PREPARE cxpp_cnt FROM @cxpp_conteo; EXECUTE cxpp_cnt; DEALLOCATE PREPARE cxpp_cnt;
 END IF;
END$$
DELIMITER ;
DELIMITER $$
BEGIN NOT ATOMIC
 IF @cxpp_estado IS NULL OR @cxpp_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: postcheck CXP M3B1 exige FINAL (tablas, columnas, indices, CHECK y FK exactos)';
 END IF;
 SELECT (SELECT COUNT(*) FROM cxp_pagos),(SELECT COUNT(*) FROM cxp_pago_aplicaciones),
  (SELECT COUNT(*) FROM cxp_pagos p WHERE p.monto_total<>COALESCE((SELECT SUM(a.monto) FROM cxp_pago_aplicaciones a WHERE a.empresa_id=p.empresa_id AND a.entidad_id=p.entidad_id AND a.pago_id=p.id),0)),
  (SELECT COUNT(*) FROM cxp_pago_aplicaciones a JOIN cxp_pagos p ON p.empresa_id=a.empresa_id AND p.entidad_id=a.entidad_id AND p.id=a.pago_id
    JOIN cxp_facturas f ON f.empresa_id=a.empresa_id AND f.entidad_id=a.entidad_id AND f.id=a.factura_id WHERE f.proveedor_id<>p.proveedor_id),
  (SELECT COUNT(*) FROM cxp_pago_aplicaciones a JOIN cxp_pagos p ON p.empresa_id=a.empresa_id AND p.entidad_id=a.entidad_id AND p.id=a.pago_id
    JOIN cxp_facturas f ON f.empresa_id=a.empresa_id AND f.entidad_id=a.entidad_id AND f.id=a.factura_id WHERE p.estado='REGISTRADO' AND f.estado_admin='ANULADA'),
  (SELECT COUNT(*) FROM cxp_facturas f WHERE f.total_neto_pagar<COALESCE((SELECT SUM(a.monto) FROM cxp_pago_aplicaciones a JOIN cxp_pagos p ON p.empresa_id=a.empresa_id AND p.entidad_id=a.entidad_id AND p.id=a.pago_id
    WHERE a.empresa_id=f.empresa_id AND a.entidad_id=f.entidad_id AND a.factura_id=f.id AND p.estado='REGISTRADO'),0)),
  (SELECT COUNT(*) FROM cxp_facturas WHERE regla_isr LIKE 'M3B1\_V1:%' AND NOT (
    (regla_isr IN ('M3B1_V1:PEQUENO_CONTRIBUYENTE_SIN_RETENCION','M3B1_V1:NO_SUJETO_ISR') AND isr_monto=0)
    OR (regla_isr='M3B1_V1:BAJO_MINIMO_SIN_RETENCION' AND isr_monto=0 AND base_neto<2800)
    OR (regla_isr='M3B1_V1:TRAMO_5_PCT' AND base_neto>=2800 AND base_neto<30000 AND isr_porcentaje=5 AND isr_monto=ROUND(base_neto*0.05,2))
    OR (regla_isr='M3B1_V1:TRAMO_FIJO_1500_MAS_7_PCT_EXCEDENTE' AND base_neto>=30000 AND isr_porcentaje=7 AND isr_monto=ROUND(1500+(base_neto-30000)*0.07,2))))
 INTO @cxpp_n_pagos,@cxpp_n_aplicaciones,@cxpp_p_total_no_suma,@cxpp_p_proveedor_distinto,@cxpp_p_pago_en_anulada,@cxpp_p_sobreaplicada,@cxpp_p_isr_tramo;
 IF @cxpp_p_total_no_suma+@cxpp_p_proveedor_distinto+@cxpp_p_pago_en_anulada+@cxpp_p_sobreaplicada+@cxpp_p_isr_tramo>0 THEN
  SELECT @cxpp_p_total_no_suma pagos_total_distinto_de_aplicaciones,@cxpp_p_proveedor_distinto aplicaciones_proveedor_distinto,@cxpp_p_pago_en_anulada pagos_vigentes_sobre_facturas_anuladas,
   @cxpp_p_sobreaplicada facturas_sobreaplicadas,@cxpp_p_isr_tramo facturas_isr_fuera_de_tramo;
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: integridad logica CXP M3B1 violada (ver conteos del SELECT anterior)';
 END IF;
END$$
DELIMITER ;
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@cxpp_estado estado_cxp_pagos,@cxpp_esperados objetos_esperados,@cxpp_presentes objetos_presentes,@cxpp_correctos objetos_correctos,
 @cxpp_n_config configuraciones_fiscales,@cxpp_n_facturas facturas_cxp,@cxpp_n_pagos pagos_cxp,@cxpp_n_aplicaciones aplicaciones_cxp,@cxpp_p_total_no_suma pagos_total_distinto_de_aplicaciones,
 @cxpp_p_proveedor_distinto aplicaciones_proveedor_distinto,@cxpp_p_pago_en_anulada pagos_vigentes_sobre_facturas_anuladas,@cxpp_p_sobreaplicada facturas_sobreaplicadas,@cxpp_p_isr_tramo facturas_isr_fuera_de_tramo;

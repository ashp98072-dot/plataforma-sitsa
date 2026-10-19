"""Genera sql/{preflight,migrate,postcheck,rollback}-2026-11-cxp-m3b1-pagos.sql con el MISMO bloque de auditoria contractual.
El DDL sale de scripts/cxp-m3b1-ddl.sql (fuente unica). Solo escribe archivos locales; no toca ninguna base de datos.
Uso: python scripts/generar-sql-cxp-m3b1.py"""
import json
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DDL = (RAIZ / "scripts" / "cxp-m3b1-ddl.sql").read_text(encoding="utf-8").strip()
PG, AP = "cxp_pagos", "cxp_pago_aplicaciones"
TABLAS = [PG, AP]
COLACION = "utf8mb4_uca1400_ai_ci"


def col(tabla, nombre, tipo, tipo_col, nulo, defecto=None, extra="", gen=None, texto=0):
    return [tabla, nombre, tipo, tipo_col, 1 if nulo else 0, defecto, extra, gen, texto]


INT = ("int", "int(11)")
COLUMNAS = [
    col(PG, "id", *INT, False, extra="auto_increment"),
    col(PG, "empresa_id", *INT, False), col(PG, "entidad_id", *INT, False), col(PG, "proveedor_id", *INT, False),
    col(PG, "fecha_pago", "date", "date", False),
    col(PG, "monto_total", "decimal", "decimal(14,2)", False),
    col(PG, "medio_pago", "varchar", "varchar(40)", False, "''", texto=1),
    col(PG, "referencia", "varchar", "varchar(120)", False, "''", texto=1),
    col(PG, "observaciones", "varchar", "varchar(500)", True, texto=1),
    col(PG, "clave_idempotencia", "varchar", "varchar(64)", False, texto=1),
    col(PG, "huella", "char", "char(64)", False, texto=1),
    col(PG, "estado", "varchar", "varchar(10)", False, "'REGISTRADO'", texto=1),
    col(PG, "creado_por", *INT, False),
    col(PG, "creado_en", "datetime", "datetime", False, "current_timestamp()"),
    col(PG, "reversado_por", *INT, True), col(PG, "reversado_en", "datetime", "datetime", True),
    col(PG, "motivo_reversion", "varchar", "varchar(500)", True, texto=1),
    col(AP, "id", *INT, False, extra="auto_increment"),
    col(AP, "empresa_id", *INT, False), col(AP, "entidad_id", *INT, False), col(AP, "pago_id", *INT, False), col(AP, "factura_id", *INT, False),
    col(AP, "monto", "decimal", "decimal(14,2)", False),
]
INDICES = [
    [PG, "PRIMARY", "id", 0],
    [PG, "uq_cxpp_ambito", "empresa_id,entidad_id,id", 0],
    [PG, "uq_cxpp_clave", "empresa_id,entidad_id,clave_idempotencia", 0],
    [PG, "idx_cxpp_listado", "empresa_id,entidad_id,estado,fecha_pago", 1],
    [PG, "idx_cxpp_proveedor", "empresa_id,entidad_id,proveedor_id,fecha_pago", 1],
    [AP, "PRIMARY", "id", 0],
    [AP, "uq_cxpa_pago_factura", "empresa_id,entidad_id,pago_id,factura_id", 0],
    [AP, "idx_cxpa_factura", "empresa_id,entidad_id,factura_id", 1],
]


def norm(clausula):
    return re.sub(r"\s+", "", clausula.replace("`", ""))


CHECKS_BRUTO = [
    (PG, "ck_cxpp_monto", "`monto_total` > 0"),
    (PG, "ck_cxpp_estado", "`estado` in ('REGISTRADO','REVERSADO')"),
    (PG, "ck_cxpp_clave", "char_length(`clave_idempotencia`) >= 8"),
    (PG, "ck_cxpp_reversion", "`estado` = 'REGISTRADO' and `reversado_por` is null and `reversado_en` is null and `motivo_reversion` is null or `estado` = 'REVERSADO' and `reversado_por` is not null and `reversado_en` is not null and `motivo_reversion` is not null and char_length(trim(`motivo_reversion`)) > 0"),
    (AP, "ck_cxpa_monto", "`monto` > 0"),
]
CHECKS = [[t, n, norm(c)] for t, n, c in CHECKS_BRUTO]
FKS = [
    [PG, "fk_cxpp_fiscal", "empresa_id,entidad_id,proveedor_id", "cxp_proveedor_fiscal", "empresa_id,entidad_id,proveedor_id"],
    [PG, "fk_cxpp_creador", "creado_por", "usuarios", "id"],
    [PG, "fk_cxpp_reversor", "reversado_por", "usuarios", "id"],
    [AP, "fk_cxpa_pago", "empresa_id,entidad_id,pago_id", PG, "empresa_id,entidad_id,id"],
    [AP, "fk_cxpa_factura", "empresa_id,entidad_id,factura_id", "cxp_facturas", "empresa_id,entidad_id,id"],
]
ESPERADOS = len(TABLAS) + len(COLUMNAS) + len(INDICES) + len(CHECKS) + len(FKS)


def lit(valor):
    """JSON dentro de un literal SQL entre comillas simples."""
    return json.dumps(valor, ensure_ascii=False, separators=(",", ":")).replace("'", "''")


AUDIT = f"""-- BEGIN CXP M3B1 CONTRACT AUDIT (identico en preflight/migrate/postcheck/rollback; SELECT INTO solo asigna variables de sesion)
SELECT NULL,NULL,NULL,NULL INTO @cxpp_estado,@cxpp_esperados,@cxpp_presentes,@cxpp_correctos;
WITH
tablas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('{lit([[t] for t in TABLAS])}','$[*]' COLUMNS(nombre VARCHAR(64) PATH '$[0]')) j
),
columnas_esperadas AS (
 SELECT j.* FROM JSON_TABLE('{lit(COLUMNAS)}','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', tipo VARCHAR(20) PATH '$[2]', tipo_col VARCHAR(30) PATH '$[3]',
  nulo INT PATH '$[4]', defecto VARCHAR(100) PATH '$[5]', extra VARCHAR(40) PATH '$[6]', gen VARCHAR(200) PATH '$[7]', texto INT PATH '$[8]')) j
),
indices_esperados AS (
 SELECT j.* FROM JSON_TABLE('{lit(INDICES)}','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', columnas VARCHAR(255) PATH '$[2]', no_unico INT PATH '$[3]')) j
),
checks_esperados AS (
 SELECT j.* FROM JSON_TABLE('{lit(CHECKS)}','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', clausula VARCHAR(1000) PATH '$[2]')) j
),
fks_esperadas AS (
 SELECT j.* FROM JSON_TABLE('{lit(FKS)}','$[*]'
 COLUMNS(tabla VARCHAR(64) PATH '$[0]', nombre VARCHAR(64) PATH '$[1]', columnas VARCHAR(255) PATH '$[2]', padre VARCHAR(64) PATH '$[3]', columnas_padre VARCHAR(255) PATH '$[4]')) j
),
indices_reales AS (
 SELECT TABLE_NAME tabla, INDEX_NAME nombre, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas, MAX(NON_UNIQUE) no_unico,
 SUM(SUB_PART IS NOT NULL) prefijos, SUM(INDEX_TYPE<>'BTREE' OR COLLATION<>'A' OR IGNORED<>'NO') incompatibles
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('{PG}','{AP}') GROUP BY TABLE_NAME,INDEX_NAME
),
fks_reales AS (
 SELECT k.TABLE_NAME tabla, k.CONSTRAINT_NAME nombre, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas,
 MAX(k.REFERENCED_TABLE_NAME) padre, MAX(k.REFERENCED_TABLE_SCHEMA) esquema_padre,
 GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_padre, MAX(r.UPDATE_RULE) regla_update, MAX(r.DELETE_RULE) regla_delete
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME IN ('{PG}','{AP}') AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME,k.CONSTRAINT_NAME
),
objetos AS (
 SELECT CONCAT('tabla:',e.nombre) objeto,(t.TABLE_NAME IS NOT NULL) presente,
 COALESCE(t.ENGINE='InnoDB' AND t.TABLE_COLLATION='{COLACION}',0) correcto
 FROM tablas_esperadas e LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=e.nombre
 UNION ALL
 SELECT CONCAT('columna:',e.tabla,'.',e.nombre),(c.COLUMN_NAME IS NOT NULL),
 COALESCE(c.DATA_TYPE=e.tipo AND c.COLUMN_TYPE=e.tipo_col AND (c.IS_NULLABLE='YES')=(e.nulo=1)
 AND ((e.defecto IS NULL AND (c.COLUMN_DEFAULT IS NULL OR c.COLUMN_DEFAULT='NULL')) OR c.COLUMN_DEFAULT=e.defecto)
 AND c.EXTRA=e.extra AND COALESCE(c.GENERATION_EXPRESSION,'')=COALESCE(e.gen,'')
 AND IF(e.texto=1,c.CHARACTER_SET_NAME='utf8mb4' AND c.COLLATION_NAME='{COLACION}',c.CHARACTER_SET_NAME IS NULL),0)
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
 WHEN conteos.esperados={ESPERADOS} AND conteos.presentes={ESPERADOS} AND conteos.correctos={ESPERADOS} THEN 'FINAL'
 ELSE 'DIVERGENTE' END,conteos.esperados,conteos.presentes,conteos.correctos
INTO @cxpp_estado,@cxpp_esperados,@cxpp_presentes,@cxpp_correctos
FROM conteos CROSS JOIN base;
-- END CXP M3B1 CONTRACT AUDIT
"""

CONTEOS = """-- Conteos de tablas M-3A/usuarios (SQL dinamico: si M-3A no esta aplicada, el estado es DIVERGENTE y no se mencionan tablas ausentes)
SELECT NULL,NULL,NULL INTO @cxpp_n_config,@cxpp_n_facturas,@cxpp_n_usuarios;
DELIMITER $$
BEGIN NOT ATOMIC
 IF (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('cxp_proveedor_fiscal','cxp_facturas'))=2 THEN
  SET @cxpp_conteo='SELECT (SELECT COUNT(*) FROM cxp_proveedor_fiscal),(SELECT COUNT(*) FROM cxp_facturas),(SELECT COUNT(*) FROM usuarios) INTO @cxpp_n_config,@cxpp_n_facturas,@cxpp_n_usuarios';
  PREPARE cxpp_cnt FROM @cxpp_conteo; EXECUTE cxpp_cnt; DEALLOCATE PREPARE cxpp_cnt;
 END IF;
END$$
DELIMITER ;
"""

DATOS = """-- BEGIN CXP M3B1 DATA AUDIT (solo lecturas; SQL dinamico para no mencionar tablas aun ausentes)
SELECT NULL,NULL INTO @cxpp_n_pagos,@cxpp_n_aplicaciones;
DELIMITER $$
BEGIN NOT ATOMIC
 IF @cxpp_estado='FINAL' THEN
  SET @cxpp_lectura='SELECT (SELECT COUNT(*) FROM cxp_pagos),(SELECT COUNT(*) FROM cxp_pago_aplicaciones) INTO @cxpp_n_pagos,@cxpp_n_aplicaciones';
  PREPARE cxpp_read FROM @cxpp_lectura; EXECUTE cxpp_read; DEALLOCATE PREPARE cxpp_read;
 END IF;
END$$
DELIMITER ;
-- END CXP M3B1 DATA AUDIT
"""

RESUMEN = """SELECT DATABASE() base_objetivo,VERSION() version_servidor,@cxpp_estado estado_cxp_pagos,@cxpp_esperados objetos_esperados,@cxpp_presentes objetos_presentes,@cxpp_correctos objetos_correctos,
 @cxpp_n_config configuraciones_fiscales,@cxpp_n_facturas facturas_cxp,@cxpp_n_pagos pagos_cxp,@cxpp_n_aplicaciones aplicaciones_cxp;
"""

PREFLIGHT = ("""-- CXP M-3B1 (pagos) - PREFLIGHT (SOLO LECTURA). NO ejecutado por la rama. Estandar contractual CLEAN | FINAL | DIVERGENTE.
-- Prerrequisito: CxP M-3A aplicada (cxp_proveedor_fiscal y cxp_facturas). Sin ella el estado es DIVERGENTE.
-- Esperado antes de migrar: estado_cxp_pagos = CLEAN. FINAL = ya aplicado (migrate sera NOOP). DIVERGENTE = DETENER.
-- Misma sesion; sin escrituras/DDL concurrentes. Se GENERA con scripts/generar-sql-cxp-m3b1.py (no editar a mano).
""" + AUDIT + CONTEOS + DATOS + RESUMEN)

MIGRATE = ("""-- CXP M-3B1 (pagos) - MIGRACION (PROPUESTA; NO ejecutada en produccion por la rama). Ejecutar SOLO tras preflight revisado y autorizado.
-- Reconoce unicamente CLEAN (aplica DDL), FINAL (NOOP) y DIVERGENTE (SIGNAL antes de cualquier DDL). Sin estados parciales continuables.
-- DDL determinista (sin IF NOT EXISTS), solo tablas NUEVAS: no altera cxp_facturas, cxp_proveedor_fiscal ni ninguna tabla existente. Sin DML ni backfill:
-- los datos historicos de CxP (facturas M-3A) no se modifican y sus saldos se derivan (monto pagadero - pagos), por lo que no requieren migracion.
-- Tras el DDL repite la auditoria en la MISMA sesion y exige FINAL y conteos de tablas existentes identicos.
-- Se GENERA con scripts/generar-sql-cxp-m3b1.py (no editar a mano).
""" + AUDIT + CONTEOS + """SELECT @cxpp_estado INTO @cxpp_inicial;
DELIMITER $$
BEGIN NOT ATOMIC
 IF @cxpp_estado IS NULL OR @cxpp_estado NOT IN ('CLEAN','FINAL') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: contrato CXP M3B1 DIVERGENTE (o M-3A ausente); no se ejecuto DDL';
 END IF;
 IF @cxpp_estado='CLEAN' THEN
""" + "\n".join(("  " + linea).rstrip() for linea in DDL.split("\n")) + """
 END IF;
END$$
DELIMITER ;
""" + AUDIT + """DELIMITER $$
BEGIN NOT ATOMIC
 DECLARE n_config,n_facturas,n_usuarios BIGINT;
 IF @cxpp_estado IS NULL OR @cxpp_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: la auditoria posterior al DDL no certifica FINAL';
 END IF;
 SELECT (SELECT COUNT(*) FROM cxp_proveedor_fiscal),(SELECT COUNT(*) FROM cxp_facturas),(SELECT COUNT(*) FROM usuarios) INTO n_config,n_facturas,n_usuarios;
 IF NOT (n_config<=>@cxpp_n_config AND n_facturas<=>@cxpp_n_facturas AND n_usuarios<=>@cxpp_n_usuarios) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: los conteos antes/despues difieren (no debe haber DML)';
 END IF;
END$$
DELIMITER ;
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@cxpp_inicial estado_inicial,@cxpp_estado estado_final,
 IF(@cxpp_inicial='CLEAN','APLICADO','NOOP') resultado,@cxpp_presentes objetos_presentes,@cxpp_correctos objetos_correctos,
 @cxpp_n_facturas facturas_cxp_intactas;
""")

POSTCHECK = ("""-- CXP M-3B1 (pagos) - POSTCHECK (SOLO LECTURA). Exige FINAL y FALLA (SIGNAL) si cualquier conteo de integridad es > 0; siempre los muestra.
-- Verifica: pagos = suma de aplicaciones, mismo proveedor pago/factura, sin pagos vigentes sobre facturas anuladas, sin sobreaplicacion, y que el ISR de
-- cada factura M3B1_V1 coincida con el tramo confirmado y su redondeo a 2 decimales (mitad hacia arriba; ROUND de MariaDB sobre DECIMAL redondea .5 alejandose de cero) (el postcheck de M-3A solo conoce 5 %, por eso este es el vigente cuando existan facturas M3B1_V1).
-- Se GENERA con scripts/generar-sql-cxp-m3b1.py (no editar a mano).
""" + AUDIT + CONTEOS + """DELIMITER $$
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
  (SELECT COUNT(*) FROM cxp_facturas WHERE regla_isr LIKE 'M3B1\\_V1:%' AND NOT (
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
""")

ROLLBACK = ("""-- CXP M-3B1 (pagos) - ROLLBACK (PROPUESTA; NO ejecutado). SOLO elimina las dos tablas NUEVAS y SOLO si el estado es FINAL y estan VACIAS.
-- Si ya existe cualquier pago (aunque este reversado) el script se DETIENE: los pagos son registros contables y NO se borran por script.
-- Estrategia de recuperacion en ese caso: (1) respaldo completo previo; (2) reversar los pagos desde la aplicacion (quedan REVERSADO con motivo y traza);
-- (3) conservar las tablas (el codigo antiguo las ignora) o, solo con autorizacion expresa, restaurar el respaldo tomado antes de la migracion.
-- Facturas M-3A y su ISR NO se tocan. Se GENERA con scripts/generar-sql-cxp-m3b1.py (no editar a mano).
""" + AUDIT + """DELIMITER $$
BEGIN NOT ATOMIC
 DECLARE n_pagos,n_aplicaciones BIGINT;
 IF @cxpp_estado IS NULL OR @cxpp_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: rollback solo sobre el estado FINAL del contrato M3B1';
 END IF;
 SELECT (SELECT COUNT(*) FROM cxp_pagos),(SELECT COUNT(*) FROM cxp_pago_aplicaciones) INTO n_pagos,n_aplicaciones;
 IF n_pagos>0 OR n_aplicaciones>0 THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: existen pagos registrados; no se eliminan por script (reversar desde la aplicacion o restaurar respaldo autorizado)';
 END IF;
 DROP TABLE cxp_pago_aplicaciones;
 DROP TABLE cxp_pagos;
END$$
DELIMITER ;
SELECT DATABASE() base_objetivo,VERSION() version_servidor,'ROLLBACK_APLICADO' resultado;
""")

for nombre, texto in (("preflight", PREFLIGHT), ("migrate", MIGRATE), ("postcheck", POSTCHECK), ("rollback", ROLLBACK)):
    (RAIZ / "sql" / f"{nombre}-2026-11-cxp-m3b1-pagos.sql").write_text(texto, encoding="utf-8", newline=chr(10))
    print("escrito", nombre, "objetos esperados:", ESPERADOS)

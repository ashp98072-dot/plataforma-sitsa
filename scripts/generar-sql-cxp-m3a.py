"""Genera sql/{preflight,migrate,postcheck}-2026-11-cxp-m3a-base.sql con el MISMO bloque de auditoria contractual.
El DDL sale de scripts/cxp-m3a-ddl.sql (fuente unica). Solo escribe archivos locales; no toca ninguna base de datos.
Uso: python scripts/generar-sql-cxp-m3a.py"""
import json
import pathlib
import re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
DDL = (RAIZ / "scripts" / "cxp-m3a-ddl.sql").read_text(encoding="utf-8").strip()
PF, FA = "cxp_proveedor_fiscal", "cxp_facturas"
TABLAS = [PF, FA]
COLACION = "utf8mb4_uca1400_ai_ci"


def col(tabla, nombre, tipo, tipo_col, nulo, defecto=None, extra="", gen=None, texto=0):
    return [tabla, nombre, tipo, tipo_col, 1 if nulo else 0, defecto, extra, gen, texto]


INT = ("int", "int(11)")
COLUMNAS = [
    col(PF, "empresa_id", *INT, False), col(PF, "entidad_id", *INT, False), col(PF, "proveedor_id", *INT, False),
    col(PF, "regimen_fiscal", "varchar", "varchar(30)", False, texto=1),
    col(PF, "sujeto_isr", "tinyint", "tinyint(1)", False),
    col(PF, "cuenta_proveedor_id", *INT, True), col(PF, "cuenta_anticipo_id", *INT, True), col(PF, "cuenta_gasto_id", *INT, True),
    col(PF, "activo", "tinyint", "tinyint(1)", False, "1"),
    col(PF, "creado_por", *INT, False),
    col(PF, "creado_en", "datetime", "datetime", False, "current_timestamp()"),
    col(PF, "actualizado_por", *INT, False),
    col(PF, "actualizado_en", "datetime", "datetime", False, "current_timestamp()", "on update current_timestamp()"),
    col(FA, "id", *INT, False, extra="auto_increment"),
    col(FA, "empresa_id", *INT, False), col(FA, "entidad_id", *INT, False), col(FA, "proveedor_id", *INT, False),
    col(FA, "tipo_documento", "varchar", "varchar(20)", False, texto=1),
    col(FA, "serie", "varchar", "varchar(40)", False, "''", texto=1),
    col(FA, "numero", "varchar", "varchar(60)", False, texto=1),
    col(FA, "serie_norm", "varchar", "varchar(40)", False, "''", texto=1),
    col(FA, "numero_norm", "varchar", "varchar(60)", False, texto=1),
    col(FA, "fecha_documento", "date", "date", False), col(FA, "fecha_vencimiento", "date", "date", True),
    col(FA, "base_neto", "decimal", "decimal(14,2)", False),
    col(FA, "iva_monto", "decimal", "decimal(14,2)", False, "0.00"),
    col(FA, "total_documento", "decimal", "decimal(14,2)", False),
    col(FA, "isr_porcentaje", "decimal", "decimal(5,2)", False, "0.00"),
    col(FA, "isr_monto", "decimal", "decimal(14,2)", False, "0.00"),
    col(FA, "total_neto_pagar", "decimal", "decimal(14,2)", False),
    col(FA, "regla_isr", "varchar", "varchar(60)", False, texto=1),
    col(FA, "regimen_fiscal_snapshot", "varchar", "varchar(30)", False, texto=1),
    col(FA, "sujeto_isr_snapshot", "tinyint", "tinyint(1)", False),
    col(FA, "observaciones", "varchar", "varchar(500)", True, texto=1),
    col(FA, "estado_admin", "varchar", "varchar(12)", False, "'REGISTRADA'", texto=1),
    col(FA, "clave_activa", "tinyint", "tinyint(1)", True, extra="STORED GENERATED", gen="if(`estado_admin` = 'REGISTRADA',1,NULL)"),
    col(FA, "creado_por", *INT, False),
    col(FA, "creado_en", "datetime", "datetime", False, "current_timestamp()"),
    col(FA, "anulado_por", *INT, True), col(FA, "anulado_en", "datetime", "datetime", True),
    col(FA, "motivo_anulacion", "varchar", "varchar(500)", True, texto=1),
]
INDICES = [
    [PF, "PRIMARY", "empresa_id,entidad_id,proveedor_id", 0], [PF, "idx_cxppf_proveedor", "empresa_id,proveedor_id", 1],
    [FA, "PRIMARY", "id", 0],
    [FA, "uq_cxpf_documento", "empresa_id,proveedor_id,serie_norm,numero_norm,clave_activa", 0],
    [FA, "uq_cxpf_ambito", "empresa_id,entidad_id,id", 0],
    [FA, "idx_cxpf_listado", "empresa_id,entidad_id,estado_admin,fecha_documento", 1],
    [FA, "idx_cxpf_proveedor", "empresa_id,entidad_id,proveedor_id,fecha_documento", 1],
]


def norm(clausula):
    return re.sub(r"\s+", "", clausula.replace("`", ""))


CHECKS_BRUTO = [
    (PF, "ck_cxppf_regimen", "`regimen_fiscal` in ('GENERAL','PEQUENO_CONTRIBUYENTE')"),
    (PF, "ck_cxppf_isr", "`sujeto_isr` in (0,1)"),
    (PF, "ck_cxppf_activo", "`activo` in (0,1)"),
    (PF, "ck_cxppf_pequeno", "`regimen_fiscal` <> 'PEQUENO_CONTRIBUYENTE' or `sujeto_isr` = 0"),
    (FA, "ck_cxpf_tipo", "`tipo_documento` in ('FACTURA','FACTURA_ESPECIAL')"),
    (FA, "ck_cxpf_estado", "`estado_admin` in ('REGISTRADA','ANULADA')"),
    (FA, "ck_cxpf_numero", "char_length(`numero_norm`) > 0"),
    (FA, "ck_cxpf_importes", "`base_neto` > 0 and `iva_monto` >= 0 and `isr_monto` >= 0 and `isr_porcentaje` >= 0"),
    (FA, "ck_cxpf_total", "`total_documento` = `base_neto` + `iva_monto`"),
    (FA, "ck_cxpf_neto", "`total_neto_pagar` = `total_documento` - `isr_monto` and `total_neto_pagar` >= 0"),
    (FA, "ck_cxpf_regimen", "`regimen_fiscal_snapshot` in ('GENERAL','PEQUENO_CONTRIBUYENTE') and `sujeto_isr_snapshot` in (0,1)"),
    (FA, "ck_cxpf_pequeno", "`regimen_fiscal_snapshot` <> 'PEQUENO_CONTRIBUYENTE' or `sujeto_isr_snapshot` = 0"),
    (FA, "ck_cxpf_isr_sujeto", "`sujeto_isr_snapshot` = 1 or `isr_monto` = 0"),
    (FA, "ck_cxpf_vencimiento", "`fecha_vencimiento` is null or `fecha_vencimiento` >= `fecha_documento`"),
    (FA, "ck_cxpf_anulacion", "`estado_admin` = 'REGISTRADA' and `anulado_por` is null and `anulado_en` is null and `motivo_anulacion` is null or `estado_admin` = 'ANULADA' and `anulado_por` is not null and `anulado_en` is not null and `motivo_anulacion` is not null and char_length(trim(`motivo_anulacion`)) > 0"),
]
CHECKS = [[t, n, norm(c)] for t, n, c in CHECKS_BRUTO]
FKS = [
    [PF, "fk_cxppf_entidad", "empresa_id,entidad_id", "cont_entidades", "empresa_id,id"],
    [PF, "fk_cxppf_proveedor", "empresa_id,proveedor_id", "compras_proveedores", "empresa_id,id"],
    [PF, "fk_cxppf_cta_proveedor", "empresa_id,entidad_id,cuenta_proveedor_id", "cont_cuentas", "empresa_id,entidad_id,id"],
    [PF, "fk_cxppf_cta_anticipo", "empresa_id,entidad_id,cuenta_anticipo_id", "cont_cuentas", "empresa_id,entidad_id,id"],
    [PF, "fk_cxppf_cta_gasto", "empresa_id,entidad_id,cuenta_gasto_id", "cont_cuentas", "empresa_id,entidad_id,id"],
    [PF, "fk_cxppf_creador", "creado_por", "usuarios", "id"],
    [PF, "fk_cxppf_editor", "actualizado_por", "usuarios", "id"],
    [FA, "fk_cxpf_fiscal", "empresa_id,entidad_id,proveedor_id", PF, "empresa_id,entidad_id,proveedor_id"],
    [FA, "fk_cxpf_creador", "creado_por", "usuarios", "id"],
    [FA, "fk_cxpf_anulador", "anulado_por", "usuarios", "id"],
]
ESPERADOS = len(TABLAS) + len(COLUMNAS) + len(INDICES) + len(CHECKS) + len(FKS)


def lit(valor):
    """JSON dentro de un literal SQL entre comillas simples."""
    return json.dumps(valor, ensure_ascii=False, separators=(",", ":")).replace("'", "''")


AUDIT = f"""-- BEGIN CXP M3A CONTRACT AUDIT (identico en preflight/migrate/postcheck; SELECT INTO solo asigna variables de sesion)
SELECT NULL,NULL,NULL,NULL INTO @cxp_estado,@cxp_esperados,@cxp_presentes,@cxp_correctos;
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
 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('{PF}','{FA}') GROUP BY TABLE_NAME,INDEX_NAME
),
fks_reales AS (
 SELECT k.TABLE_NAME tabla, k.CONSTRAINT_NAME nombre, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas,
 MAX(k.REFERENCED_TABLE_NAME) padre, MAX(k.REFERENCED_TABLE_SCHEMA) esquema_padre,
 GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) columnas_padre, MAX(r.UPDATE_RULE) regla_update, MAX(r.DELETE_RULE) regla_delete
 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME
 WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.TABLE_NAME IN ('{PF}','{FA}') AND k.REFERENCED_TABLE_NAME IS NOT NULL GROUP BY k.TABLE_NAME,k.CONSTRAINT_NAME
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
 WHEN conteos.esperados={ESPERADOS} AND conteos.presentes={ESPERADOS} AND conteos.correctos={ESPERADOS} THEN 'FINAL'
 ELSE 'DIVERGENTE' END,conteos.esperados,conteos.presentes,conteos.correctos
INTO @cxp_estado,@cxp_esperados,@cxp_presentes,@cxp_correctos
FROM conteos CROSS JOIN base;
-- END CXP M3A CONTRACT AUDIT
"""

CONTEOS = """SELECT (SELECT COUNT(*) FROM cont_cxp),(SELECT COUNT(*) FROM compras_proveedores),(SELECT COUNT(*) FROM cont_entidades),
 (SELECT COUNT(*) FROM cont_cuentas),(SELECT COUNT(*) FROM usuarios)
INTO @cxp_n_legacy,@cxp_n_proveedores,@cxp_n_entidades,@cxp_n_cuentas,@cxp_n_usuarios;
"""

DATOS = """-- BEGIN CXP M3A DATA AUDIT (solo lecturas; SQL dinamico para no mencionar tablas aun ausentes)
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
"""

RESUMEN = """SELECT DATABASE() base_objetivo,VERSION() version_servidor,@cxp_estado estado_cxp_rollout,@cxp_esperados objetos_esperados,@cxp_presentes objetos_presentes,@cxp_correctos objetos_correctos,
 @cxp_n_legacy filas_cont_cxp_legacy,@cxp_n_proveedores proveedores,@cxp_n_config configuraciones_fiscales,@cxp_n_facturas facturas_cxp;
"""

PREFLIGHT = ("""-- CXP M-3A - PREFLIGHT (SOLO LECTURA). NO ejecutado por la rama. Estandar contractual CLEAN | FINAL | DIVERGENTE.
-- Esperado antes de migrar: estado_cxp_rollout = CLEAN. FINAL = ya aplicado (migrate sera NOOP). DIVERGENTE = DETENER.
-- Misma sesion; sin escrituras/DDL concurrentes. Se GENERA con scripts/generar-sql-cxp-m3a.py (no editar a mano).
""" + AUDIT + CONTEOS + DATOS + RESUMEN)

MIGRATE = ("""-- CXP M-3A - MIGRACION (PROPUESTA; NO ejecutada en produccion por la rama). Ejecutar SOLO tras preflight revisado y autorizado.
-- Reconoce unicamente CLEAN (aplica DDL), FINAL (NOOP) y DIVERGENTE (SIGNAL antes de cualquier DDL). Sin estados parciales continuables.
-- DDL determinista (sin IF NOT EXISTS), solo tablas NUEVAS: no altera cont_cxp ni ninguna tabla existente. Sin DML ni backfill.
-- Tras el DDL repite la auditoria en la MISMA sesion y exige FINAL y conteos de tablas existentes identicos.
-- Se GENERA con scripts/generar-sql-cxp-m3a.py (no editar a mano).
""" + AUDIT + CONTEOS + """SELECT @cxp_estado INTO @cxp_inicial;
DELIMITER $$
BEGIN NOT ATOMIC
 IF @cxp_estado IS NULL OR @cxp_estado NOT IN ('CLEAN','FINAL') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: contrato CXP M3A DIVERGENTE; no se ejecuto DDL';
 END IF;
 IF @cxp_estado='CLEAN' THEN
""" + "\n".join("  " + linea for linea in DDL.split("\n")) + """
 END IF;
END$$
DELIMITER ;
""" + AUDIT + """DELIMITER $$
BEGIN NOT ATOMIC
 DECLARE n_legacy,n_proveedores,n_entidades,n_cuentas,n_usuarios BIGINT;
 IF @cxp_estado IS NULL OR @cxp_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: la auditoria posterior al DDL no certifica FINAL';
 END IF;
 SELECT (SELECT COUNT(*) FROM cont_cxp),(SELECT COUNT(*) FROM compras_proveedores),(SELECT COUNT(*) FROM cont_entidades),
  (SELECT COUNT(*) FROM cont_cuentas),(SELECT COUNT(*) FROM usuarios) INTO n_legacy,n_proveedores,n_entidades,n_cuentas,n_usuarios;
 IF NOT (n_legacy<=>@cxp_n_legacy AND n_proveedores<=>@cxp_n_proveedores AND n_entidades<=>@cxp_n_entidades AND n_cuentas<=>@cxp_n_cuentas AND n_usuarios<=>@cxp_n_usuarios) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: los conteos antes/despues difieren (no debe haber DML)';
 END IF;
END$$
DELIMITER ;
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@cxp_inicial estado_inicial,@cxp_estado estado_final,
 IF(@cxp_inicial='CLEAN','APLICADO','NOOP') resultado,@cxp_presentes objetos_presentes,@cxp_correctos objetos_correctos,
 @cxp_n_legacy filas_cont_cxp_legacy_intactas;
""")

POSTCHECK = ("""-- CXP M-3A - POSTCHECK (SOLO LECTURA). Exige FINAL y FALLA (SIGNAL) si cualquier conteo de integridad es > 0; siempre los muestra.
-- Se GENERA con scripts/generar-sql-cxp-m3a.py (no editar a mano).
""" + AUDIT + CONTEOS + """DELIMITER $$
BEGIN NOT ATOMIC
 IF @cxp_estado IS NULL OR @cxp_estado<>'FINAL' THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: postcheck CXP M3A exige FINAL (tablas, columnas, indices, CHECK y FK exactos)';
 END IF;
 SELECT (SELECT COUNT(*) FROM cxp_proveedor_fiscal),(SELECT COUNT(*) FROM cxp_facturas),
  (SELECT COUNT(*) FROM cxp_proveedor_fiscal f JOIN cont_cuentas c ON c.empresa_id=f.empresa_id AND c.entidad_id=f.entidad_id AND c.id=f.cuenta_proveedor_id WHERE c.tipo<>'Pasivo'),
  (SELECT COUNT(*) FROM cxp_proveedor_fiscal f JOIN cont_cuentas c ON c.empresa_id=f.empresa_id AND c.entidad_id=f.entidad_id AND c.id=f.cuenta_anticipo_id WHERE c.tipo<>'Activo'),
  (SELECT COUNT(*) FROM cxp_proveedor_fiscal f JOIN cont_cuentas c ON c.empresa_id=f.empresa_id AND c.entidad_id=f.entidad_id AND c.id=f.cuenta_gasto_id WHERE c.tipo<>'Gasto'),
  (SELECT COUNT(*) FROM cxp_facturas WHERE isr_porcentaje>0 AND isr_monto<>ROUND(base_neto*isr_porcentaje/100,2)),
  (SELECT COUNT(*) FROM cxp_facturas WHERE isr_porcentaje=0 AND isr_monto<>0),
  (SELECT COUNT(*) FROM cxp_facturas f JOIN cxp_proveedor_fiscal p ON p.empresa_id=f.empresa_id AND p.entidad_id=f.entidad_id AND p.proveedor_id=f.proveedor_id
    JOIN compras_proveedores c ON c.empresa_id=p.empresa_id AND c.id=p.proveedor_id WHERE c.empresa_id<>f.empresa_id)
 INTO @cxp_n_config,@cxp_n_facturas,@cxp_p_cta_proveedor,@cxp_p_cta_anticipo,@cxp_p_cta_gasto,@cxp_p_isr_calculo,@cxp_p_isr_sin_porcentaje,@cxp_p_proveedor_ajeno;
 IF @cxp_p_cta_proveedor+@cxp_p_cta_anticipo+@cxp_p_cta_gasto+@cxp_p_isr_calculo+@cxp_p_isr_sin_porcentaje+@cxp_p_proveedor_ajeno>0 THEN
  SELECT @cxp_p_cta_proveedor cuentas_proveedor_no_pasivo,@cxp_p_cta_anticipo cuentas_anticipo_no_activo,@cxp_p_cta_gasto cuentas_gasto_no_gasto,
   @cxp_p_isr_calculo isr_no_coincide_con_porcentaje,@cxp_p_isr_sin_porcentaje isr_sin_porcentaje,@cxp_p_proveedor_ajeno facturas_proveedor_de_otra_empresa;
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='DETENER: integridad logica CXP M3A violada (ver conteos del SELECT anterior)';
 END IF;
END$$
DELIMITER ;
SELECT DATABASE() base_objetivo,VERSION() version_servidor,@cxp_estado estado_cxp_rollout,@cxp_esperados objetos_esperados,@cxp_presentes objetos_presentes,@cxp_correctos objetos_correctos,
 @cxp_n_config configuraciones_fiscales,@cxp_n_facturas facturas_cxp,@cxp_p_cta_proveedor cuentas_proveedor_no_pasivo,@cxp_p_cta_anticipo cuentas_anticipo_no_activo,
 @cxp_p_cta_gasto cuentas_gasto_no_gasto,@cxp_p_isr_calculo isr_no_coincide_con_porcentaje,@cxp_p_isr_sin_porcentaje isr_sin_porcentaje,@cxp_p_proveedor_ajeno facturas_proveedor_de_otra_empresa,
 @cxp_n_legacy filas_cont_cxp_legacy;
""")

for nombre, texto in (("preflight", PREFLIGHT), ("migrate", MIGRATE), ("postcheck", POSTCHECK)):
    (RAIZ / "sql" / f"{nombre}-2026-11-cxp-m3a-base.sql").write_text(texto, encoding="utf-8", newline=chr(10))
    print("escrito", nombre, "objetos esperados:", ESPERADOS)

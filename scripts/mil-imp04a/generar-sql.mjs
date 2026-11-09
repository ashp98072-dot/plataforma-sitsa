// Generador offline. No conecta DB ni ejecuta SQL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tables = {
  fact_credito_perfiles: {
    cols: [ ['empresa_id','int','NO'],['entidad_id','int','NO'],['cliente_id','int','NO'],['dias','int','NO'],['aprobada','tinyint','NO'],['revision','int','NO'],['actualizado_por','int','NO'],['actualizado_en','datetime','NO'] ],
    ddl: `empresa_id INT NOT NULL, entidad_id INT NOT NULL, cliente_id INT NOT NULL,
 dias INT NOT NULL, aprobada TINYINT NOT NULL, revision INT NOT NULL,
 actualizado_por INT NOT NULL, actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (empresa_id,entidad_id,cliente_id),
 CONSTRAINT fk_fcp_entidad FOREIGN KEY (empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_fcp_cliente FOREIGN KEY (empresa_id,cliente_id) REFERENCES clientes(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_fcp_actor FOREIGN KEY (actualizado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ck_fcp_dias CHECK (dias BETWEEN 0 AND 365),
 CONSTRAINT ck_fcp_aprobada CHECK (aprobada IN (0,1)),
 CONSTRAINT ck_fcp_revision CHECK (revision > 0)`,
    keys: [['PRIMARY','empresa_id,entidad_id,cliente_id',0]],
    fks: [['fk_fcp_entidad','empresa_id,entidad_id','cont_entidades','empresa_id,id'],['fk_fcp_cliente','empresa_id,cliente_id','clientes','empresa_id,id'],['fk_fcp_actor','actualizado_por','usuarios','id']],
    checks: [['ck_fcp_dias','dias between 0 and 365'],['ck_fcp_aprobada','aprobada in (0,1)'],['ck_fcp_revision','revision > 0']],
  },
  fact_vencimientos: {
    cols: [['factura_id','int','NO'],['empresa_id','int','NO'],['entidad_id','int','NO'],['cliente_id','int','NO'],['fecha_base','date','NO'],['dias','int','NO'],['vencimiento','date','NO'],['regla','varchar','NO'],['fuente','varchar','NO'],['revision','int','NO'],['creado_por','int','NO'],['creado_en','datetime','NO']],
    ddl: `factura_id INT NOT NULL, empresa_id INT NOT NULL, entidad_id INT NOT NULL, cliente_id INT NOT NULL,
 fecha_base DATE NOT NULL, dias INT NOT NULL, vencimiento DATE NOT NULL,
 regla VARCHAR(40) NOT NULL, fuente VARCHAR(10) NOT NULL, revision INT NOT NULL,
 creado_por INT NOT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (factura_id), KEY ix_fv_ambito (empresa_id,entidad_id,vencimiento,factura_id),
 CONSTRAINT fk_fv_factura FOREIGN KEY (empresa_id,entidad_id,cliente_id,factura_id) REFERENCES fact_facturas(empresa_id,entidad_id,cliente_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_fv_entidad FOREIGN KEY (empresa_id,entidad_id) REFERENCES cont_entidades(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_fv_cliente FOREIGN KEY (empresa_id,cliente_id) REFERENCES clientes(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_fv_actor FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT ck_fv_dias CHECK (dias BETWEEN 0 AND 365),
 CONSTRAINT ck_fv_fecha CHECK (vencimiento = DATE_ADD(fecha_base, INTERVAL dias DAY)),
 CONSTRAINT ck_fv_regla CHECK (regla = 'MIL04A_CALENDARIO_V1'),
 CONSTRAINT ck_fv_fuente CHECK ((fuente='CONTADO' AND dias=0 AND revision=0) OR (fuente='PERFIL' AND revision>0))`,
    keys: [['PRIMARY','factura_id',0],['ix_fv_ambito','empresa_id,entidad_id,vencimiento,factura_id',1]],
    fks: [['fk_fv_factura','empresa_id,entidad_id,cliente_id,factura_id','fact_facturas','empresa_id,entidad_id,cliente_id,id'],['fk_fv_entidad','empresa_id,entidad_id','cont_entidades','empresa_id,id'],['fk_fv_cliente','empresa_id,cliente_id','clientes','empresa_id,id'],['fk_fv_actor','creado_por','usuarios','id']],
    checks: [['ck_fv_dias','dias between 0 and 365'],['ck_fv_fecha','vencimiento = (fecha_base + interval dias day)'],['ck_fv_regla',"regla = 'MIL04A_CALENDARIO_V1'"],['ck_fv_fuente',"(fuente='CONTADO' AND dias=0 AND revision=0) OR (fuente='PERFIL' AND revision>0)"]],
  },
};
const triggers = [
 ['fv_no_update','UPDATE',"SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Snapshot de vencimiento inmutable'"],
 ['fv_no_delete','DELETE',"SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Snapshot de vencimiento inmutable'"],
];
const lit = v => `'${String(v).replaceAll("'", "''")}'`;
const norm = expr => `LOWER(REGEXP_REPLACE(REPLACE(REPLACE(REPLACE(${expr},CHAR(96),''),'(',''),')',''),'[[:space:]]',''))`;
const names = Object.keys(tables).map(lit).join(',');
const expected = [];
const anchors = [['clientes','uq_mil04a_cliente_ambito','empresa_id,id'],['fact_facturas','uq_mil04a_factura_ambito','empresa_id,entidad_id,cliente_id,id']];
for(const [table,name,cols] of anchors) expected.push(`SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)} AND INDEX_NAME=${lit(name)} GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)=${lit(cols)} AND MAX(NON_UNIQUE)=0 AND SUM(SUB_PART IS NOT NULL)=0)`);
for (const [table,t] of Object.entries(tables)) {
  expected.push(`SELECT COALESCE((SELECT ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_uca1400_ai_ci' FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)}),0) ok`);
  expected.push(`SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)})=${t.cols.length}`);
  for (const [i,[column,type,nullable]] of t.cols.entries()) {
    expected.push(`SELECT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)} AND COLUMN_NAME=${lit(column)} AND ORDINAL_POSITION=${i+1} AND DATA_TYPE=${lit(type)} AND IS_NULLABLE=${lit(nullable)} AND EXTRA='' AND COALESCE(GENERATION_EXPRESSION,'')='' AND ${type==='datetime'?"COLUMN_DEFAULT='current_timestamp()'":"(COLUMN_DEFAULT IS NULL OR COLUMN_DEFAULT='NULL')"}${type==='varchar'?` AND CHARACTER_MAXIMUM_LENGTH=${column==='regla'?40:10} AND COLLATION_NAME='utf8mb4_uca1400_ai_ci'`:''}${type==='int'?" AND COLUMN_TYPE='int(11)'":type==='tinyint'?" AND COLUMN_TYPE='tinyint(4)'":''})`);
  }
  for (const [name,cols,nu] of t.keys) expected.push(`SELECT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)} AND INDEX_NAME=${lit(name)} GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)=${lit(cols)} AND MAX(NON_UNIQUE)=${nu} AND SUM(SUB_PART IS NOT NULL)=0)`);
  for (const [name,cols,parent,pcols] of t.fks) expected.push(`SELECT EXISTS(SELECT 1 FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=${lit(table)} AND k.CONSTRAINT_NAME=${lit(name)} AND k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME=${lit(parent)} AND r.DELETE_RULE='RESTRICT' AND r.UPDATE_RULE='RESTRICT' GROUP BY k.CONSTRAINT_NAME HAVING GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION)=${lit(cols)} AND GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION)=${lit(pcols)})`);
  for (const [name,clause] of t.checks) expected.push(`SELECT EXISTS(SELECT 1 FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)} AND CONSTRAINT_NAME=${lit(name)} AND ${norm('CHECK_CLAUSE')}=${norm(lit(clause))})`);
  expected.push(`SELECT (SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)})=${t.fks.length}`);
  expected.push(`SELECT (SELECT COUNT(*) FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=${lit(table)})=${t.checks.length}`);
}
for (const [name,event,stmt] of triggers) expected.push(`SELECT EXISTS(SELECT 1 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=${lit(name)} AND EVENT_OBJECT_TABLE='fact_vencimientos' AND ACTION_TIMING='BEFORE' AND EVENT_MANIPULATION=${lit(event)} AND ${norm('ACTION_STATEMENT')}=${norm(lit(stmt))})`);
const audit = `WITH objetos(ok) AS (${expected.join('\nUNION ALL\n')}),
base AS (SELECT (VERSION() LIKE '11.8.%MariaDB%' AND @@foreign_key_checks=1 AND @@check_constraint_checks=1 AND
 (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('clientes','cont_entidades','fact_facturas','usuarios') AND ENGINE='InnoDB')=4 AND
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('clientes','cont_entidades','fact_facturas','usuarios') AND COLUMN_NAME='id' AND COLUMN_TYPE='int(11)' AND IS_NULLABLE='NO')=4 AND
 (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_TYPE='int(11)' AND ((TABLE_NAME IN ('clientes','cont_entidades') AND COLUMN_NAME='empresa_id' AND IS_NULLABLE='NO') OR (TABLE_NAME='fact_facturas' AND COLUMN_NAME IN ('empresa_id','cliente_id') AND IS_NULLABLE='NO') OR (TABLE_NAME='fact_facturas' AND COLUMN_NAME='entidad_id')))=5 AND
 EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='cont_entidades' AND NON_UNIQUE=0 GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='empresa_id,id')) ok),
presentes AS (SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${names})) + (SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME IN ('fv_no_update','fv_no_delete')) + (SELECT COUNT(DISTINCT TABLE_NAME,INDEX_NAME) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME='clientes' AND INDEX_NAME='uq_mil04a_cliente_ambito') OR (TABLE_NAME='fact_facturas' AND INDEX_NAME='uq_mil04a_factura_ambito'))) n)
SELECT CASE WHEN base.ok=0 THEN 'DIVERGENTE' WHEN presentes.n=0 THEN 'CLEAN' WHEN presentes.n=6 AND MIN(objetos.ok)=1 THEN 'FINAL' ELSE 'DIVERGENTE' END AS estado
FROM objetos CROSS JOIN base CROSS JOIN presentes GROUP BY base.ok,presentes.n`;
const header = '-- MIL-IMP-04A. PROPUESTA para revisión. NO ejecutar en Hostinger. Sin DML/backfill.\n';
fs.writeFileSync(path.join(root,'src/lib/facturacion/credito-esquema.ts'),'// Generado por scripts/mil-imp04a/generar-sql.mjs. Solo SELECT, sin DDL.\nexport const SQL_ESQUEMA_CREDITO = '+JSON.stringify(audit)+';\n');
fs.mkdirSync(path.join(root,'sql/mil-imp04a'),{recursive:true});
fs.writeFileSync(path.join(root,'sql/mil-imp04a/preflight.sql'),header+audit+';\n');
fs.writeFileSync(path.join(root,'sql/mil-imp04a/postcheck.sql'),header+audit+';\n');
const guard = audit.replace(' AS estado',' INTO @mil04a_estado');
const ddl = Object.entries(tables).map(([name,t])=>`CREATE TABLE IF NOT EXISTS ${name} (\n${t.ddl}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;`).join('\n');
const tr = triggers.map(([name,event,stmt])=>`CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${event} ON fact_vencimientos FOR EACH ROW ${stmt};`).join('\n');
fs.writeFileSync(path.join(root,'sql/mil-imp04a/migrate.sql'),header+guard+`;\nDELIMITER $$\nBEGIN NOT ATOMIC
 IF @mil04a_estado NOT IN ('CLEAN','FINAL') OR @mil04a_estado IS NULL THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='MIL04A DIVERGENTE: detener sin DDL';
 END IF;
END$$\nDELIMITER ;\n`+`ALTER TABLE clientes ADD UNIQUE INDEX IF NOT EXISTS uq_mil04a_cliente_ambito (empresa_id,id);\nALTER TABLE fact_facturas ADD UNIQUE INDEX IF NOT EXISTS uq_mil04a_factura_ambito (empresa_id,entidad_id,cliente_id,id);\n`+ddl+'\n'+tr+'\n'+audit+';\n');
fs.writeFileSync(path.join(root,'sql/mil-imp04a/contract.json'),JSON.stringify({anchors,tables,triggers},null,2)+'\n');

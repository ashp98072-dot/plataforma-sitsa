// TMS-INCIDENCIAS-ENTREGA — pruebas B13 CONTRA MariaDB real efímera. SOLO se cargan desde el ejecutor (vitest.b13.config.mts). Datos exclusivamente ficticios.
// Validan el SQL EXACTO de PR #599 (SHA 92ec5123): estructura, escenarios (limpio, con datos, ya aplicado, divergente, collation mixta), integridad multiempresa, unicidad,
// CHECK (incluido NULL), append-only, concurrencia y que las tablas/datos previos permanecen intactos. NO prueban aplicación ni API (no existen todavía).
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { adminOptions, assertAdminOptions } from "../pricesmart-api06a/safety.mjs";
import { tmsFixtureStatements, tmsMigrationStatements } from "../pricesmart-api06a/ddl.mjs";
import { B13_TABLES, b13MigrationStatements, SEED, usuariosFixtureStatements } from "./ddl.mjs";

const manifestPath = process.env.PS06A_MANIFEST;
if (!manifestPath || process.env.PS06A_PHASE !== "b13") throw new Error("B13: esta suite solo se ejecuta desde el ejecutor del laboratorio.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { schema: string; appUser: string; port: number; pipe: string; runDir: string };
const SCH = manifest.schema;
const ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// ---- SQL bajo prueba y sentencias de apoyo (las MISMAS que usa el ejecutor)
const MIG: string[] = b13MigrationStatements(read("sql/migrate-2026-11-tms-incidencias-resoluciones.sql"));
const PRE: string[] = [...tmsFixtureStatements(read("scripts/ci/pricesmart-api06a/tms-fixture.sql")), ...usuariosFixtureStatements(read("scripts/ci/tms-incidencias-b13/fixture-usuarios.sql")), ...tmsMigrationStatements(read("sql/migrate-2026-11-tms-parada-confirmaciones.sql"))];
const DIV_RES = "CREATE TABLE tms_parada_incidencia_resoluciones (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, nota VARCHAR(10) NULL) ENGINE=InnoDB";
const DIV_CONF = "CREATE TABLE tms_parada_confirmaciones (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NOT NULL) ENGINE=InnoDB";
const SC_RES_INSERT = "INSERT INTO tms_parada_incidencia_resoluciones (confirmacion_id, empresa_id, plan_id, parada_id, secuencia, decision, terminal, evidencia_corte_id, justificacion, resuelto_por, resuelto_por_usuario, resuelto_en) VALUES (1, 1, 101, 1011, 1, 'MANTENER_PENDIENTE', NULL, NULL, 'justificacion de prueba', 1, 'admin.ficticio', '2026-11-11 12:00:00')";
const CONV = ["tms_planes_viaje", "tms_plan_paradas", "tms_parada_confirmaciones"].map((t) => `ALTER TABLE ${t} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`);   // simula tablas históricas con otra collation
const ALLOWED = new Set<string>([...PRE, ...MIG, ...SEED, ...CONV, DIV_RES, DIV_CONF, SC_RES_INSERT]);

// ---- conexiones: la cuenta de APLICACIÓN del run (solo SELECT/INSERT sobre lo nuevo) y la administrativa (solo pipe del run, lecturas y DDL de escenarios en lista cerrada)
const pool = mysql.createPool({ host: "127.0.0.1", port: manifest.port, user: manifest.appUser, password: process.env.PS06A_APP_PASSWORD, database: SCH, connectionLimit: 12 });
afterAll(async () => { await pool.end(); });
type Header = { insertId: number; affectedRows: number };
const run = async (sql: string, params: unknown[] = []) => (await pool.execute(sql, params as never))[0] as unknown as Header;
const errnoOf = async (p: Promise<unknown>) => { try { await p; return 0; } catch (e) { return (e as { errno?: number }).errno ?? -1; } };
async function adminConn() { const o = adminOptions(manifest); assertAdminOptions(o, manifest); return mysql.createConnection(o); }
async function admin(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  if (!/^(SELECT|SHOW|CHECKSUM TABLE)\s/i.test(sql) || sql.includes(";")) throw new Error("admin(): solo SELECT/SHOW/CHECKSUM de una sentencia");
  const c = await adminConn(); try { await c.query(`USE \`${SCH}\``); const [rows] = await c.query(sql, params); return rows as Record<string, unknown>[]; } finally { await c.end(); }
}
const SC_RE = new RegExp(`^${SCH}_sc[a-z0-9]{1,6}$`);
const scName = (suf: string) => `${SCH}_sc${suf}`;
async function createDb(suf: string, collate?: string) {
  const c = await adminConn(); try { await c.query(`CREATE DATABASE \`${scName(suf)}\` CHARACTER SET utf8mb4${collate ? ` COLLATE ${collate}` : ""}`); } finally { await c.end(); }
}
async function dropDb(suf: string) { const c = await adminConn(); try { await c.query(`DROP DATABASE IF EXISTS \`${scName(suf)}\``); } finally { await c.end(); } }
/** Ejecuta sentencias de la lista cerrada en la base indicada (el esquema del run o un escenario propio); se detiene en el primer error y devuelve su número. */
async function ddl(db: string, sqls: string[]): Promise<{ failedAt: number | null; errno: number }> {
  if (db !== SCH && !SC_RE.test(db)) throw new Error("base no permitida");
  const c = await adminConn();
  try {
    await c.query(`USE \`${db}\``);
    for (const [i, sql] of sqls.entries()) {
      if (!ALLOWED.has(sql)) throw new Error(`sentencia fuera de la lista cerrada: ${sql.slice(0, 60)}`);
      try { await c.query(sql); } catch (e) { return { failedAt: i, errno: (e as { errno?: number }).errno ?? -1 }; }
    }
    return { failedAt: null, errno: 0 };
  } finally { await c.end(); }
}
const TABLES = [...B13_TABLES, "tms_parada_confirmaciones"];
const normType = (t: unknown) => String(t).replace(/^(bigint|int|tinyint|smallint)\(\d+\)/, "$1");
async function firma(db: string) {
  const plain = (rows: Record<string, unknown>[]) => JSON.parse(JSON.stringify(rows)) as Record<string, unknown>[];
  const cols = plain(await admin("SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_DEFAULT d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?) ORDER BY TABLE_NAME, ORDINAL_POSITION", [db, TABLES]));
  const idx = plain(await admin("SELECT TABLE_NAME t, INDEX_NAME i, NON_UNIQUE nu, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cs FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?) GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE ORDER BY 1, 2", [db, TABLES]));
  const fks = plain(await admin("SELECT rc.TABLE_NAME t, rc.CONSTRAINT_NAME n, rc.REFERENCED_TABLE_NAME r, rc.DELETE_RULE d, rc.UPDATE_RULE u, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION) cs, GROUP_CONCAT(k.REFERENCED_COLUMN_NAME ORDER BY k.ORDINAL_POSITION) rs "
    + "FROM information_schema.REFERENTIAL_CONSTRAINTS rc JOIN information_schema.KEY_COLUMN_USAGE k ON k.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND k.TABLE_NAME = rc.TABLE_NAME "
    + "WHERE rc.CONSTRAINT_SCHEMA = ? AND rc.TABLE_NAME IN (?) GROUP BY rc.TABLE_NAME, rc.CONSTRAINT_NAME, rc.REFERENCED_TABLE_NAME, rc.DELETE_RULE, rc.UPDATE_RULE ORDER BY 1, 2", [db, TABLES]));
  const checks = plain(await admin("SELECT TABLE_NAME t, CONSTRAINT_NAME n, CHECK_CLAUSE cl FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME IN (?) ORDER BY 1, 2", [db, TABLES]));
  return { cols, idx, fks, checks };
}
const checksums = async (db: string, tables: string[]) => Object.fromEntries((await Promise.all(tables.map(async (t) => [t, String((await admin(`CHECKSUM TABLE \`${db}\`.\`${t}\``))[0].Checksum)] as const))));
const EXISTING = ["usuarios", "tms_planes_viaje", "tms_plan_paradas", "flota_viajes", "flota_viaje_evidencias", "tms_parada_confirmaciones"];
const tablesIn = async (db: string) => (await admin("SELECT TABLE_NAME t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY 1", [db])).map((r) => String(r.t));

// ---- datos de prueba con la cuenta de aplicación (FICTICIOS)
let n = 0;
type Inc = { empresa: number; plan: number; viaje: number; parada: number; evidencia: number; confirmacion: number };
async function nuevaIncidencia(empresa: 1 | 2 = 1): Promise<Inc> {
  n++; const plan = empresa === 1 ? 101 : 201; const viaje = empresa === 1 ? 11 : 21;
  const parada = (await run("INSERT INTO tms_plan_paradas (plan_id, orden, lugar_nombre, tipo) VALUES (?, 9, ?, 'Entrega')", [plan, `lab ${n}`])).insertId;
  const evidencia = (await run("INSERT INTO flota_viaje_evidencias (empresa_id, viaje_id, tipo, ruta_relativa, nombre_original, capturado_en, subido_por, creado_at, parada_id) VALUES (?, ?, 'producto', ?, 'x.jpg', '2026-11-11 11:00:00', 'portal:LAB', '2026-11-11 11:00:00', ?)", [empresa, viaje, `lab/x${n}.jpg`, parada])).insertId;
  const confirmacion = await confirmar({ empresa, plan, viaje, parada }, evidencia, "PARCIAL");
  return { empresa, plan, viaje, parada, evidencia, confirmacion };
}
async function confirmar(i: { empresa: number; plan: number; viaje: number; parada: number }, evidencia: number, resultado: string) {
  const ent = resultado === "ENTREGADA_POR_PILOTO";
  return (await run("INSERT INTO tms_parada_confirmaciones (empresa_id, plan_id, viaje_id, parada_id, parada_tipo, parada_orden, parada_lugar_nombre, resultado, revision, entrega_vigente, piloto_empleado_id, piloto_personal_id, piloto_usuario, evidencia_id, evidencia_ruta, nota, confirmado_en) VALUES (?, ?, ?, ?, 'Entrega', 9, 'lab', ?, ?, ?, 1, 1, 'portal:LAB', ?, ?, ?, '2026-11-11 11:01:00')",
    [i.empresa, i.plan, i.viaje, i.parada, resultado, ent ? "NO_REQUERIDA" : "PENDIENTE", ent ? 1 : null, evidencia, `lab/x${evidencia}.jpg`, ent ? null : "nota de prueba larga"])).insertId;
}
async function evidenciaNueva(i: Inc) { n++; return (await run("INSERT INTO flota_viaje_evidencias (empresa_id, viaje_id, tipo, ruta_relativa, nombre_original, capturado_en, subido_por, creado_at, parada_id) VALUES (?, ?, 'producto', ?, 'y.jpg', '2026-11-11 12:30:00', 'portal:LAB', '2026-11-11 12:30:00', ?)", [i.empresa, i.viaje, `lab/y${n}.jpg`, i.parada])).insertId; }
const RES_COLS = ["confirmacion_id", "empresa_id", "plan_id", "parada_id", "secuencia", "decision", "terminal", "evidencia_corte_id", "justificacion", "resuelto_por", "resuelto_por_usuario", "resuelto_en"];
type Ex = { execute(sql: string, p: unknown[]): Promise<unknown> };
function insertRes(i: Inc, over: Record<string, unknown> = {}, conn: Ex = pool as unknown as Ex) {
  const v: Record<string, unknown> = { confirmacion_id: i.confirmacion, empresa_id: i.empresa, plan_id: i.plan, parada_id: i.parada, secuencia: 1, decision: "MANTENER_PENDIENTE", terminal: null, evidencia_corte_id: null,
    justificacion: "justificacion de prueba", resuelto_por: 1, resuelto_por_usuario: "admin.ficticio", resuelto_en: "2026-11-11 12:00:00", ...over };
  return conn_exec(conn, `INSERT INTO tms_parada_incidencia_resoluciones (${RES_COLS.join(",")}) VALUES (${RES_COLS.map(() => "?").join(",")})`, RES_COLS.map((c) => v[c]));
}
const conn_exec = (c: Ex, sql: string, p: unknown[]) => c.execute(sql, p);
const AUTORIZA = (i: Inc, over: Record<string, unknown> = {}, conn?: Ex) => insertRes(i, { decision: "AUTORIZAR_NUEVO_INTENTO", terminal: 1, evidencia_corte_id: i.evidencia, ...over }, conn);
async function resIdOf(i: Inc, secuencia: number) { return Number((await admin("SELECT id FROM tms_parada_incidencia_resoluciones WHERE confirmacion_id = ? AND secuencia = ?", [i.confirmacion, secuencia]))[0].id); }
function insertReint(c: { conf: number; res: number; empresa: number; plan: number; parada: number; decision?: string }, conn: Ex = pool as unknown as Ex) {
  return c.decision === undefined
    ? conn.execute("INSERT INTO tms_parada_confirmacion_reintentos (confirmacion_id, resolucion_id, empresa_id, plan_id, parada_id) VALUES (?, ?, ?, ?, ?)", [c.conf, c.res, c.empresa, c.plan, c.parada])
    : conn.execute("INSERT INTO tms_parada_confirmacion_reintentos (confirmacion_id, resolucion_id, empresa_id, plan_id, parada_id, decision) VALUES (?, ?, ?, ?, ?, ?)", [c.conf, c.res, c.empresa, c.plan, c.parada, c.decision]);
}
const count = async (table: string, where: string, params: unknown[] = []) => Number((await admin(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params))[0].n);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const resultOf = async (p: Promise<unknown>) => { try { await p; return 0; } catch (e) { return (e as { errno?: number }).errno ?? -1; } };

// ---- esperado (estructura)
const EXPECTED_COLS: Record<string, string[]> = {
  tms_parada_incidencia_resoluciones: ["id:bigint unsigned:NO", "empresa_id:int:NO", "plan_id:int:NO", "parada_id:int:NO", "confirmacion_id:bigint unsigned:NO", "secuencia:int unsigned:NO", "decision:varchar(24):NO", "terminal:tinyint:YES",
    "evidencia_corte_id:int:YES", "justificacion:varchar(500):NO", "resuelto_por:int:NO", "resuelto_por_usuario:varchar(80):NO", "resuelto_en:datetime:NO"],
  tms_parada_confirmacion_reintentos: ["confirmacion_id:bigint unsigned:NO", "resolucion_id:bigint unsigned:NO", "empresa_id:int:NO", "plan_id:int:NO", "parada_id:int:NO", "decision:varchar(24):NO"],
};
const EXPECTED_IDX: Record<string, string> = {
  "tms_parada_incidencia_resoluciones.PRIMARY": "0:id", "tms_parada_incidencia_resoluciones.uq_tmspr_secuencia": "0:confirmacion_id,secuencia", "tms_parada_incidencia_resoluciones.uq_tmspr_terminal": "0:confirmacion_id,terminal",
  "tms_parada_incidencia_resoluciones.uq_tmspr_ref": "0:id,empresa_id,plan_id,parada_id,decision", "tms_parada_incidencia_resoluciones.idx_tmspr_empresa_fecha": "1:empresa_id,resuelto_en", "tms_parada_incidencia_resoluciones.idx_tmspr_parada": "1:empresa_id,parada_id,id",
  "tms_parada_confirmacion_reintentos.PRIMARY": "0:confirmacion_id", "tms_parada_confirmacion_reintentos.uq_tmspcr_resolucion": "0:resolucion_id", "tms_parada_confirmaciones.uq_tmspc_ref": "0:id,empresa_id,plan_id,parada_id",
};
const EXPECTED_FKS: Record<string, string> = {
  "tms_parada_incidencia_resoluciones.fk_tmspr_confirmacion": "tms_parada_confirmaciones|confirmacion_id,empresa_id,plan_id,parada_id>id,empresa_id,plan_id,parada_id", "tms_parada_incidencia_resoluciones.fk_tmspr_plan": "tms_planes_viaje|empresa_id,plan_id>empresa_id,id",
  "tms_parada_incidencia_resoluciones.fk_tmspr_usuario": "usuarios|resuelto_por>id", "tms_parada_confirmacion_reintentos.fk_tmspcr_confirmacion": "tms_parada_confirmaciones|confirmacion_id,empresa_id,plan_id,parada_id>id,empresa_id,plan_id,parada_id",
  "tms_parada_confirmacion_reintentos.fk_tmspcr_resolucion": "tms_parada_incidencia_resoluciones|resolucion_id,empresa_id,plan_id,parada_id,decision>id,empresa_id,plan_id,parada_id,decision",
};
const EXPECTED_CHECKS = ["tms_parada_confirmacion_reintentos.ck_tmspcr_decision", "tms_parada_incidencia_resoluciones.ck_tmspr_decision", "tms_parada_incidencia_resoluciones.ck_tmspr_forma", "tms_parada_incidencia_resoluciones.ck_tmspr_justificacion", "tms_parada_incidencia_resoluciones.ck_tmspr_secuencia"];
const NEW_TABLE_COLS = (f: Awaited<ReturnType<typeof firma>>, t: string) => f.cols.filter((c) => c.t === t).map((c) => `${c.c}:${normType(c.ty)}:${c.n}`);
const idxMap = (f: Awaited<ReturnType<typeof firma>>) => Object.fromEntries(f.idx.map((r) => [`${r.t}.${r.i}`, `${r.nu}:${r.cs}`]));
const fkMap = (f: Awaited<ReturnType<typeof firma>>) => Object.fromEntries(f.fks.map((r) => [`${r.t}.${r.n}`, `${r.r}|${r.cs}>${r.rs}`]));

describe("B13 estructura efectiva y compatibilidad", () => {
  it("B13.1 el SQL de #599 crea exactamente lo diseñado: columnas, índices, 5 claves foráneas RESTRICT y 5 CHECK; las tablas son InnoDB", async () => {
    expect(await tablesIn(SCH)).toEqual(expect.arrayContaining([...B13_TABLES]));
    const engines = await admin("SELECT TABLE_NAME t, ENGINE e FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)", [SCH, B13_TABLES]); expect(engines.every((e) => e.e === "InnoDB")).toBe(true);
    const f = await firma(SCH);
    for (const t of B13_TABLES) expect(NEW_TABLE_COLS(f, t).map((c) => c.replace(/^(\w+):/, "$1:"))).toEqual(EXPECTED_COLS[t]);
    const idx = idxMap(f); for (const [k, v] of Object.entries(EXPECTED_IDX)) expect(idx[k], k).toBe(v);
    const extra = Object.keys(idx).filter((k) => B13_TABLES.some((t) => k.startsWith(`${t}.`)) && !(k in EXPECTED_IDX));
    expect(extra.every((k) => /\.fk_tmsp(c|r|cr)_/.test(k)), extra.join(",")).toBe(true);   // los únicos índices extra son los implícitos de las claves foráneas
    const fks = fkMap(f); for (const [k, v] of Object.entries(EXPECTED_FKS)) expect(fks[k], k).toBe(v);
    for (const r of f.fks.filter((x) => B13_TABLES.includes(String(x.t)))) { expect(r.d, `${r.n} DELETE`).toBe("RESTRICT"); expect(r.u, `${r.n} UPDATE`).toBe("RESTRICT"); }
    expect(f.checks.filter((c) => B13_TABLES.includes(String(c.t))).map((c) => `${c.t}.${c.n}`)).toEqual(EXPECTED_CHECKS);
    const forma = String(f.checks.find((c) => c.n === "ck_tmspr_forma")?.cl); expect(forma).toContain("<=>");   // el CHECK debe tolerar NULL (lección de B12)
  });
  it("B13.2 compatibilidad de tipos y collation: cada columna de clave foránea coincide con la referenciada, y las tablas de apoyo reproducen los tipos reales", async () => {
    const pares = await admin("SELECT k.TABLE_NAME t, k.CONSTRAINT_NAME n, k.COLUMN_NAME c, k.REFERENCED_TABLE_NAME rt, k.REFERENCED_COLUMN_NAME rc, a.COLUMN_TYPE at, b.COLUMN_TYPE bt, a.CHARACTER_SET_NAME acs, b.CHARACTER_SET_NAME bcs, a.COLLATION_NAME aco, b.COLLATION_NAME bco "
      + "FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.COLUMNS a ON a.TABLE_SCHEMA = k.TABLE_SCHEMA AND a.TABLE_NAME = k.TABLE_NAME AND a.COLUMN_NAME = k.COLUMN_NAME "
      + "JOIN information_schema.COLUMNS b ON b.TABLE_SCHEMA = k.REFERENCED_TABLE_SCHEMA AND b.TABLE_NAME = k.REFERENCED_TABLE_NAME AND b.COLUMN_NAME = k.REFERENCED_COLUMN_NAME WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME IN (?) AND k.REFERENCED_TABLE_NAME IS NOT NULL", [SCH, B13_TABLES]);
    expect(pares.length).toBe(16);   // 4+2+1 (resoluciones) + 4+5 (reintentos) columnas de FK
    for (const p of pares) { expect(p.at, `${p.n}.${p.c} tipo`).toBe(p.bt); expect(p.acs ?? null, `${p.n}.${p.c} charset`).toBe(p.bcs ?? null); expect(p.aco ?? null, `${p.n}.${p.c} collation`).toBe(p.bco ?? null); }
    const tablas = await admin("SELECT TABLE_NAME t, TABLE_COLLATION c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)", [SCH, TABLES]);
    expect(new Set(tablas.map((t) => t.c)).size).toBe(1);   // en este laboratorio las tres nacen con la misma collation por defecto; la mixta se prueba en B13.7
    // fidelidad de las tablas de apoyo frente al esquema REAL
    expect(read("sql/schema.sql")).toMatch(/CREATE TABLE IF NOT EXISTS usuarios \(\s*id INT AUTO_INCREMENT PRIMARY KEY,\s*username VARCHAR\(80\) NOT NULL UNIQUE/);
    expect(read("sql/schema.sql")).toMatch(/CREATE TABLE IF NOT EXISTS tms_planes_viaje \(\s*id INT AUTO_INCREMENT PRIMARY KEY,\s*empresa_id INT NOT NULL,/);
    expect(read("src/lib/flota/schema.ts")).toMatch(/CREATE TABLE IF NOT EXISTS tms_plan_paradas \(\s*id INT AUTO_INCREMENT PRIMARY KEY,\s*plan_id INT NOT NULL,/);
  });
});

describe("B13 las tablas y datos previos permanecen intactos", () => {
  it("B13.13 tras aplicar el SQL por primera vez: el CONTENIDO de las 6 tablas previas no cambió y la única diferencia de definición es el índice único uq_tmspc_ref", async () => {
    const s = JSON.parse(readFileSync(path.join(manifest.runDir, "pre-state.json"), "utf8")) as { pre: { checksums: { Table: string; Checksum: string | null }[]; showConfirmaciones: string }; post: { checksums: { Table: string; Checksum: string | null }[]; showConfirmaciones: string }; migrationResults: string[] };
    expect(s.migrationResults).toHaveLength(3); expect(s.pre.checksums).toHaveLength(6);
    for (const [i, c] of s.pre.checksums.entries()) { expect(c.Checksum, c.Table).not.toBeNull(); expect(s.post.checksums[i].Checksum, c.Table).toBe(c.Checksum); }
    const norm = (t: string) => t.split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => l && !/^\)/.test(l) && !/AUTO_INCREMENT=/.test(l));
    const antes = new Set(norm(s.pre.showConfirmaciones)); const despues = norm(s.post.showConfirmaciones).filter((l) => !antes.has(l));
    expect(despues).toHaveLength(1); expect(despues[0]).toContain("uq_tmspc_ref"); expect(despues[0]).toContain("(`id`,`empresa_id`,`plan_id`,`parada_id`)");
    expect([...antes].filter((l) => !norm(s.post.showConfirmaciones).includes(l))).toEqual([]);   // no desapareció ninguna línea de la definición previa
    expect(await count("tms_parada_confirmaciones", "id IN (1, 2, 3)")).toBe(3);
  });
});

describe("B13 escenarios de aplicación", () => {
  it("B13.4 esquema YA aplicado con datos: reejecutar el SQL no falla, no cambia la estructura ni el contenido (idempotente)", async () => {
    const antes = await firma(SCH); const sumsAntes = await checksums(SCH, [...EXISTING, ...B13_TABLES]);
    const r1 = await ddl(SCH, MIG); expect(r1).toEqual({ failedAt: null, errno: 0 });
    const r2 = await ddl(SCH, MIG); expect(r2).toEqual({ failedAt: null, errno: 0 });
    expect(await firma(SCH)).toEqual(antes); expect(await checksums(SCH, [...EXISTING, ...B13_TABLES])).toEqual(sumsAntes);
  });
  it("B13.3 esquema LIMPIO con datos previos: el SQL se aplica sin perder datos, queda IGUAL que el esquema principal y se puede reejecutar", async () => {
    await dropDb("a"); await createDb("a"); try {
      expect(await ddl(scName("a"), [...PRE, ...SEED])).toEqual({ failedAt: null, errno: 0 });
      const antes = await checksums(scName("a"), EXISTING);
      expect(await ddl(scName("a"), MIG)).toEqual({ failedAt: null, errno: 0 });
      expect(await checksums(scName("a"), EXISTING)).toEqual(antes);
      const f = await firma(scName("a")); expect(f).toEqual(await firma(SCH));
      expect(await ddl(scName("a"), MIG)).toEqual({ failedAt: null, errno: 0 }); expect(await firma(scName("a"))).toEqual(f); expect(await checksums(scName("a"), EXISTING)).toEqual(antes);
    } finally { await dropDb("a"); }
  });
  it("B13.5 esquema DIVERGENTE (tabla de resoluciones preexistente distinta): el SQL NO la corrige en silencio, falla de forma limpia al crear reintentos y la comparación estructural lo detecta", async () => {
    await dropDb("b"); await createDb("b"); try {
      expect(await ddl(scName("b"), [...PRE, ...SEED, DIV_RES])).toEqual({ failedAt: null, errno: 0 });
      const r = await ddl(scName("b"), MIG);
      expect(r.failedAt).toBe(2); expect([1005, 1822, 1215, 1005]).toContain(r.errno);   // ALTER ok, CREATE IF NOT EXISTS de resoluciones se OMITE sin error, y reintentos falla: clave foránea imposible
      expect(await tablesIn(scName("b"))).not.toContain("tms_parada_confirmacion_reintentos");
      const cols = await admin("SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tms_parada_incidencia_resoluciones' ORDER BY ORDINAL_POSITION", [scName("b")]);
      expect(cols.map((c) => c.c)).toEqual(["id", "nota"]);   // la divergencia PERSISTE: IF NOT EXISTS no la repara
      expect(await firma(scName("b"))).not.toEqual(await firma(SCH));   // el postcheck estructural SÍ la detecta
    } finally { await dropDb("b"); }
  });
  it("B13.6 confirmaciones DIVERGENTE (sin parada_id): el ALTER falla en la primera sentencia y NO se crea ninguna tabla nueva", async () => {
    await dropDb("c"); await createDb("c"); try {
      const pre = [...PRE.slice(0, 8), DIV_CONF];   // 7 tablas de apoyo + usuarios, y una confirmaciones divergente en lugar de la real
      expect(PRE.slice(0, 8).every((s) => /^CREATE TABLE (?!tms_parada_confirmaciones)/.test(s))).toBe(true);
      expect(await ddl(scName("c"), pre)).toEqual({ failedAt: null, errno: 0 });
      const r = await ddl(scName("c"), MIG); expect(r.failedAt).toBe(0); expect(r.errno).toBe(1072);   // «Key column 'parada_id' doesn't exist»
      expect(await tablesIn(scName("c"))).not.toEqual(expect.arrayContaining([...B13_TABLES]));
    } finally { await dropDb("c"); }
  });
  it("B13.7 collation MIXTA (tablas históricas general_ci y tablas nuevas con la collation por defecto): el SQL se aplica y las claves foráneas funcionan entre ambas", async () => {
    await dropDb("d"); await createDb("d"); try {
      expect(await ddl(scName("d"), [...PRE, ...SEED])).toEqual({ failedAt: null, errno: 0 });
      expect(await ddl(scName("d"), CONV)).toEqual({ failedAt: null, errno: 0 });   // las tablas históricas pasan a general_ci; las nuevas nacerán con la collation por defecto del charset
      expect(await ddl(scName("d"), MIG)).toEqual({ failedAt: null, errno: 0 });
      const t = await admin("SELECT TABLE_NAME t, TABLE_COLLATION c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)", [scName("d"), TABLES]);
      const by = Object.fromEntries(t.map((x) => [String(x.t), String(x.c)])); expect(by.tms_parada_confirmaciones).toBe("utf8mb4_general_ci"); expect(by.tms_parada_incidencia_resoluciones).toBe("utf8mb4_uca1400_ai_ci");
      expect(await ddl(scName("d"), [SC_RES_INSERT])).toEqual({ failedAt: null, errno: 0 });   // la FK compuesta resuelve entre tablas de collation distinta
      expect(Number((await admin(`SELECT COUNT(*) AS n FROM \`${scName("d")}\`.tms_parada_incidencia_resoluciones`))[0].n)).toBe(1);
    } finally { await dropDb("d"); }
  });
});

describe("B13 integridad, unicidad y restricciones (cuenta de aplicación, escrituras incompatibles)", () => {
  it("B13.8 integridad MULTIEMPRESA: las claves foráneas compuestas rechazan resoluciones y reintentos que mezclan empresa, plan, parada, usuario o decisión", async () => {
    const e1 = await nuevaIncidencia(1); const e2 = await nuevaIncidencia(2);
    expect(await errnoOf(insertRes(e1, { empresa_id: 2 }))).toBe(1452);   // empresa distinta a la de la confirmación
    expect(await errnoOf(insertRes(e1, { plan_id: 102 }))).toBe(1452); expect(await errnoOf(insertRes(e1, { parada_id: e2.parada }))).toBe(1452); expect(await errnoOf(insertRes(e1, { confirmacion_id: e2.confirmacion }))).toBe(1452);
    expect(await errnoOf(insertRes(e1, { confirmacion_id: 999999 }))).toBe(1452); expect(await errnoOf(insertRes(e1, { resuelto_por: 999 }))).toBe(1452);
    expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id IN (?, ?)", [e1.confirmacion, e2.confirmacion])).toBe(0);
    // camino válido de cada empresa
    await insertRes(e1); await AUTORIZA(e2);
    // reintentos
    const mant = await resIdOf(e1, 1); const aut2 = await resIdOf(e2, 1);
    const c2 = await confirmar(e2, await evidenciaNueva(e2), "PARCIAL"); const c1 = await confirmar(e1, await evidenciaNueva(e1), "PARCIAL");
    expect(await errnoOf(insertReint({ conf: c1, res: mant, empresa: 1, plan: 101, parada: e1.parada }))).toBe(1452);   // la resolución es MANTENER (decisión distinta)
    expect(await errnoOf(insertReint({ conf: c2, res: aut2, empresa: 1, plan: 101, parada: e2.parada }))).toBe(1452);   // empresa/plan de otra empresa
    expect(await errnoOf(insertReint({ conf: c1, res: aut2, empresa: 2, plan: 201, parada: e2.parada }))).toBe(1452);   // confirmación de la empresa 1 con la autorización de la 2
    expect(await errnoOf(insertReint({ conf: c2, res: aut2, empresa: 2, plan: 201, parada: e1.parada }))).toBe(1452);   // parada ajena
    expect(await errnoOf(insertReint({ conf: c2, res: aut2, empresa: 2, plan: 201, parada: e2.parada, decision: "MANTENER_PENDIENTE" }))).toBe(4025);   // CHECK de decisión
    expect(await errnoOf(insertReint({ conf: c2, res: aut2, empresa: 2, plan: 201, parada: e2.parada }))).toBe(0);   // el camino válido sí entra
    expect(await count("tms_parada_confirmacion_reintentos", "confirmacion_id IN (?, ?)", [c1, c2])).toBe(1);
  });
  it("B13.9 unicidad: secuencia por incidencia, una sola decisión que cierra, una autorización consumida una sola vez, muchas «mantener» permitidas", async () => {
    const i = await nuevaIncidencia(1);
    for (const s of [1, 2, 3]) await insertRes(i, { secuencia: s });   // varias MANTENER_PENDIENTE (terminal NULL no choca)
    expect(await errnoOf(insertRes(i, { secuencia: 3 }))).toBe(1062);   // secuencia repetida
    await AUTORIZA(i, { secuencia: 4 });
    expect(await errnoOf(AUTORIZA(i, { secuencia: 5 }))).toBe(1062);   // segunda decisión terminal
    expect(await errnoOf(insertRes(i, { secuencia: 5, decision: "CERRAR_SIN_ENTREGA", terminal: 1 }))).toBe(1062);
    const res = await resIdOf(i, 4); const c1 = await confirmar(i, await evidenciaNueva(i), "PARCIAL"); const c2 = await confirmar(i, await evidenciaNueva(i), "PARCIAL");
    await insertReint({ conf: c1, res, empresa: i.empresa, plan: i.plan, parada: i.parada });
    expect(await errnoOf(insertReint({ conf: c2, res, empresa: i.empresa, plan: i.plan, parada: i.parada }))).toBe(1062);   // autorización ya consumida
    expect(await errnoOf(insertReint({ conf: c1, res, empresa: i.empresa, plan: i.plan, parada: i.parada }))).toBe(1062);   // misma confirmación dos veces
    expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id = ?", [i.confirmacion])).toBe(4);
  });
  it("B13.10 CHECK: decisión, forma (con NULL: sin falsos «desconocidos»), secuencia y justificación; límites exactos", async () => {
    const i = await nuevaIncidencia(1); let s = 0;
    const malo = async (over: Record<string, unknown>, esperado = 4025, etiqueta = JSON.stringify(over)) => { s++; expect(await errnoOf(insertRes(i, { secuencia: 100 + s, ...over })), etiqueta).toBe(esperado); };
    await malo({ decision: "OTRA" }); await malo({ decision: "ENTREGADA" }); await malo({ decision: "RECIBIDA_POR_PRICESMART" });   // ninguna decisión de entrega/recepción existe
    await malo({ decision: "MANTENER_PENDIENTE", terminal: 1 }); await malo({ decision: "MANTENER_PENDIENTE", evidencia_corte_id: 5 });
    await malo({ decision: "AUTORIZAR_NUEVO_INTENTO", terminal: null, evidencia_corte_id: 5 }); await malo({ decision: "AUTORIZAR_NUEVO_INTENTO", terminal: 1, evidencia_corte_id: null });
    await malo({ decision: "AUTORIZAR_NUEVO_INTENTO", terminal: 0, evidencia_corte_id: 5 });
    await malo({ decision: "CERRAR_SIN_ENTREGA", terminal: null }); await malo({ decision: "CERRAR_SIN_ENTREGA", terminal: 1, evidencia_corte_id: 7 });
    await malo({ secuencia: 0 }, 4025, "secuencia 0"); await malo({ justificacion: "         " }); await malo({ justificacion: "corta" }); await malo({ justificacion: "123456789" });
    await malo({ justificacion: "x".repeat(501) }, 1406, "justificación de 501");
    expect(await errnoOf(insertRes(i, { secuencia: 200, justificacion: "1234567890" }))).toBe(0);   // 10 caracteres exactos
    expect(await errnoOf(insertRes(i, { secuencia: 201, justificacion: "x".repeat(500) }))).toBe(0);   // 500 exactos
    expect(await errnoOf(insertRes(i, { secuencia: 202, justificacion: "   diez   " }))).toBe(4025);   // los espacios de los extremos no cuentan (TRIM)
    expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id = ?", [i.confirmacion])).toBe(2);
  });
  it("B13.11 APPEND-ONLY: la cuenta de aplicación no puede actualizar, borrar, truncar ni alterar; plan/usuario/parada referenciados no se borran (RESTRICT); la copia de la evidencia se conserva", async () => {
    const i = await nuevaIncidencia(1); await insertRes(i); const res = await resIdOf(i, 1); expect(res).toBeGreaterThan(0);
    for (const t of B13_TABLES) {
      expect(await errnoOf(pool.execute(`UPDATE ${t} SET empresa_id = empresa_id WHERE 1 = 0`))).toBe(1142);
      expect(await errnoOf(pool.execute(`DELETE FROM ${t} WHERE 1 = 0`))).toBe(1142);
      expect(await errnoOf(pool.query(`TRUNCATE TABLE ${t}`))).toBe(1142); expect(await errnoOf(pool.query(`ALTER TABLE ${t} ADD COLUMN x INT`))).toBe(1142); expect(await errnoOf(pool.query(`DROP TABLE ${t}`))).toBe(1142);
    }
    expect(await errnoOf(pool.execute("UPDATE tms_parada_confirmaciones SET nota = nota WHERE 1 = 0"))).toBe(1142);
    expect(await errnoOf(pool.execute("DELETE FROM tms_planes_viaje WHERE id = ?", [i.plan]))).toBe(1451);   // el plan tiene confirmación y resolución
    expect(await errnoOf(pool.execute("DELETE FROM usuarios WHERE id = 1"))).toBe(1451);   // el usuario que resolvió
    expect(await errnoOf(pool.execute("DELETE FROM tms_plan_paradas WHERE id = ?", [i.parada]))).toBe(1451);
    // la base NO impide borrar la fila de evidencia (lo impide el guard de la aplicación, B12); pero la confirmación conserva su copia y nada se propaga
    await run("DELETE FROM flota_viaje_evidencias WHERE id = ?", [i.evidencia]);
    const [c] = await admin("SELECT evidencia_id, evidencia_ruta, resultado FROM tms_parada_confirmaciones WHERE id = ?", [i.confirmacion]);
    expect(c.evidencia_ruta).toBe(`lab/x${i.evidencia}.jpg`); expect(c.resultado).toBe("PARCIAL"); expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id = ?", [i.confirmacion])).toBe(1);
  });
});

describe("B13 concurrencia real (varias conexiones)", () => {
  it("B13.12 dos escrituras simultáneas incompatibles: una gana y la otra recibe 1062 al confirmar la primera; si la primera revierte, la segunda entra; ráfagas de 10 dejan exactamente una", async () => {
    // (a) misma secuencia: B espera el bloqueo del índice de A y falla cuando A confirma
    const a = await nuevaIncidencia(1); const ca = await pool.getConnection(); const cb = await pool.getConnection();
    try {
      await ca.beginTransaction(); await insertRes(a, { secuencia: 1 }, ca as unknown as Ex);
      const pb = resultOf(insertRes(a, { secuencia: 1 }, cb as unknown as Ex)); await sleep(500); await ca.commit(); expect(await pb).toBe(1062);
      expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id = ?", [a.confirmacion])).toBe(1);
      // (b) dos decisiones que cierran con secuencias distintas: la segunda espera el índice `terminal` y falla al confirmar la primera
      const b = await nuevaIncidencia(1);
      await ca.beginTransaction(); await AUTORIZA(b, { secuencia: 1 }, ca as unknown as Ex);
      const pb2 = resultOf(insertRes(b, { secuencia: 2, decision: "CERRAR_SIN_ENTREGA", terminal: 1 }, cb as unknown as Ex)); await sleep(500); await ca.commit(); expect(await pb2).toBe(1062);
      expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id = ? AND terminal = 1", [b.confirmacion])).toBe(1);
      // (c) si la primera transacción revierte, la segunda entra
      const c = await nuevaIncidencia(1);
      await ca.beginTransaction(); await insertRes(c, { secuencia: 1 }, ca as unknown as Ex);
      const pc = resultOf(insertRes(c, { secuencia: 1 }, cb as unknown as Ex)); await sleep(500); await ca.rollback(); expect(await pc).toBe(0);
      expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id = ?", [c.confirmacion])).toBe(1);
      // (d) doble consumo de la misma autorización
      const d = await nuevaIncidencia(1); await AUTORIZA(d); const res = await resIdOf(d, 1);
      const c1 = await confirmar(d, await evidenciaNueva(d), "PARCIAL"); const c2 = await confirmar(d, await evidenciaNueva(d), "PARCIAL");
      await ca.beginTransaction(); await insertReint({ conf: c1, res, empresa: d.empresa, plan: d.plan, parada: d.parada }, ca as unknown as Ex);
      const pd = resultOf(insertReint({ conf: c2, res, empresa: d.empresa, plan: d.plan, parada: d.parada }, cb as unknown as Ex)); await sleep(500); await ca.commit(); expect(await pd).toBe(1062);
      expect(await count("tms_parada_confirmacion_reintentos", "resolucion_id = ?", [res])).toBe(1);
    } finally { ca.release(); cb.release(); }
    // (e) ráfaga de 10 escrituras simultáneas con la misma secuencia: exactamente una entra
    const e = await nuevaIncidencia(1);
    const codes = await Promise.all(Array.from({ length: 10 }, () => resultOf(insertRes(e, { secuencia: 1 }))));
    expect(codes.filter((x) => x === 0)).toHaveLength(1); expect(codes.filter((x) => x === 1062)).toHaveLength(9);
    // (f) ráfaga de 10 cierres con secuencias distintas: exactamente uno
    const f = await nuevaIncidencia(1);
    const codes2 = await Promise.all(Array.from({ length: 10 }, (_, k) => resultOf(insertRes(f, { secuencia: k + 1, decision: "CERRAR_SIN_ENTREGA", terminal: 1 }))));
    expect(codes2.filter((x) => x === 0)).toHaveLength(1); expect(codes2.filter((x) => x === 1062)).toHaveLength(9);
    expect(await count("tms_parada_incidencia_resoluciones", "confirmacion_id = ?", [f.confirmacion])).toBe(1);
  });
});

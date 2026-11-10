// Pruebas ESTÁTICAS del DDL de laboratorio y del reporte. No hay base de datos ni procesos.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { adminStatements, deriveLabDdl, labDdlStatements, LAB_NOTE, SIGNAL_LINE, splitStatements, TABLES } from "./ddl.mjs";
import { createManifest, IDENTITY_QUERIES, SqlGate } from "./safety.mjs";
import { LAB_SCOPES } from "./constants.mjs";
import { BLOCKS, renderMarkdown, summarize } from "./report.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const stagingPath = path.join(here, "../../../docs/integraciones/pricesmart/api01/staging.sql.in");
const staging = fs.readFileSync(stagingPath, "utf8");
const lf = staging.replace(/\r\n/g, "\n");
const mk = () => { let i = 0; const m = createManifest({ randomBytes: (n: number) => crypto.createHash("sha256").update(`ddl:${i++}`).digest().subarray(0, n), tempRoot: fs.realpathSync.native(os.tmpdir()) }); m.port = 50321; return m; };

describe("DDL de laboratorio derivado de staging.sql.in", () => {
  it("staging.sql.in no cambió (SHA-256 sobre LF fijado; si cambia, revisar de nuevo el laboratorio)", () => {
    expect(crypto.createHash("sha256").update(lf).digest("hex")).toBe("32aacd8fcd400ccefcb93b6c9d271c70833b3130b294f57abc7203ad3149a6ab");
  });
  it("la ÚNICA diferencia es la línea SIGNAL de bloqueo (1 línea retirada, 1 nota añadida)", () => {
    const derived = deriveLabDdl(staging);
    const a = lf.split("\n"); const b = derived.split("\n");
    expect(b.length).toBe(a.length);
    const changed = a.map((line, i) => [line, b[i]] as const).filter(([x, y]) => x !== y);
    expect(changed).toEqual([[SIGNAL_LINE, LAB_NOTE]]);
  });
  it("produce exactamente 5 CREATE TABLE en el orden de dependencia, sin DROP/ALTER/GRANT/USE/SIGNAL", () => {
    const st = labDdlStatements(staging);
    expect(st).toHaveLength(5);
    st.forEach((s, i) => expect(s.startsWith(`CREATE TABLE ${TABLES[i]} (`)).toBe(true));
    expect(st.join("\n")).not.toMatch(/\b(DROP|TRUNCATE|ALTER|DELETE|GRANT|SIGNAL|USE)\b/);
  });
  it("rechaza entradas manipuladas", () => {
    expect(() => deriveLabDdl("CREATE TABLE x (id INT);")).toThrow(/SIGNAL/);
    expect(() => deriveLabDdl(`${lf}\n${SIGNAL_LINE}\n`)).toThrow(/repetido/);
    expect(() => labDdlStatements(`${lf}\nDROP TABLE ps_api01_orders;\n`)).toThrow();
    expect(() => labDdlStatements(lf.replace("CREATE TABLE ps_api01_scopes", "CREATE TABLE ps_api01_scopes_x"))).toThrow(/tabla inesperado/);
    expect(() => splitStatements("CREATE TABLE a (x VARCHAR(5) DEFAULT 'a;b');")).toThrow(/';'/);
    expect(() => splitStatements("DELIMITER //\nSELECT 1//")).toThrow(/DELIMITER/);
  });
});

describe("lista cerrada de SQL administrativo", () => {
  const m = mk(); const list = adminStatements(m, staging);
  it("orden, contenido y ausencia de operaciones destructivas o privilegios amplios", () => {
    expect(list[0]).toBe(`CREATE DATABASE \`${m.schema}\` CHARACTER SET utf8mb4`);
    expect(list[1]).toBe(`USE \`${m.schema}\``);
    expect(list.filter((s) => /^CREATE TABLE /.test(s))).toHaveLength(6);   // 5 del DDL + novalvion_environment
    expect(list.filter((s) => /^INSERT INTO ps_api01_scopes/.test(s))).toHaveLength(LAB_SCOPES.length);
    const joined = list.join("\n");
    expect(joined).not.toMatch(/\b(DROP|TRUNCATE|ALTER|DELETE|FLUSH|SET PASSWORD|LOAD_FILE|INTO OUTFILE|LOAD DATA)\b|ALL PRIVILEGES|GRANT OPTION|\*\.\*|WITH GRANT/i);
  });
  it("las cuentas y GRANT apuntan solo a la base del run y al host 127.0.0.1", () => {
    const grants = list.filter((s) => s.startsWith("GRANT "));
    expect(grants).toHaveLength(6);
    for (const g of grants) { expect(g).toContain(`\`${m.schema}\`.`); expect(g).toContain(`\`${m.user}\`@\`127.0.0.1\``); }
    const create = list.filter((s) => s.startsWith("CREATE USER "));
    expect(create).toHaveLength(1); expect(create[0]).toContain(`\`${m.user}\`@\`127.0.0.1\``);
    expect(list.filter((s) => s.includes(m.secrets.DB_PASSWORD))).toEqual(create);
  });
  it("el usuario de ejecución NO tiene DELETE, DDL ni escritura sobre eventos/scopes", () => {
    const text = list.filter((s) => s.startsWith("GRANT ")).join("\n");
    expect(text).not.toMatch(/DELETE|DROP|CREATE|ALTER|INDEX|REFERENCES|EXECUTE|TRIGGER/);
    expect(text).not.toContain("ps_api01_scopes");
    expect(text).toMatch(/GRANT UPDATE \(state, version, cancellation_hash, cancellation_reason, cancellation_receipt_json\) ON/);
  });
  it("SqlGate: ninguna de ellas pasa antes de confirmar la identidad; todas pasan después; nada más pasa", () => {
    const g = new SqlGate(IDENTITY_QUERIES, [...list, "SHUTDOWN"]);
    for (const s of list) expect(() => g.check(s)).toThrow(/antes de confirmar/);
    g.confirm();
    for (const s of list) expect(g.check(s)).toBe("approved");
    for (const bad of [`DROP DATABASE \`${m.schema}\``, "DROP DATABASE mysql", "CREATE DATABASE `otra`", "GRANT ALL PRIVILEGES ON *.* TO 'x'@'%'", `TRUNCATE ${m.schema}.ps_api01_orders`, "DELETE FROM ps_api01_orders", "SET GLOBAL read_only=1"]) expect(() => g.check(bad)).toThrow();
  });
  it("la forma de la contraseña es obligatoria (no se acepta un valor libre)", () => {
    const x = mk(); x.secrets.DB_PASSWORD = "contraseña-libre";
    expect(() => adminStatements(x, staging)).toThrow(/contraseña/);
  });
});

describe("informe PASS/FAIL/SKIP", () => {
  const passed = (title: string, status = "passed") => ({ title, ancestorTitles: [], status, failureMessages: [] as string[] });
  it("sin resultados no se declara PASS: todos los bloques quedan NO EJECUTADA", () => {
    const s = summarize([], []);
    expect(BLOCKS.every((b) => s.blocks[b].status === "NO EJECUTADA")).toBe(true); expect(s.overall).toBe("INCOMPLETO");
  });
  it("conserva FAIL y SKIP reales y marca los bloques", () => {
    const rep = { testResults: [{ assertionResults: [passed("B1.1 a"), passed("B1.2 b", "failed"), passed("B2.1 c", "skipped"), passed("B3.1 d")] }] };
    const s = summarize([rep], [{ id: "B0.1", name: "motor", status: "PASS" }]);
    expect(s.counts).toEqual({ PASS: 3, FAIL: 1, SKIP: 1 });   // incluye B0.1 del ejecutor
    expect(s.blocks.B1.status).toBe("FAIL"); expect(s.blocks.B2.status).toBe("SKIP"); expect(s.blocks.B3.status).toBe("PASS"); expect(s.blocks.B4.status).toBe("NO EJECUTADA");
    expect(s.overall).toBe("FAIL");
    expect(renderMarkdown(s)).toContain("| B1 | FAIL | 1 | 1 | 0 |");
  });
  it("un caso sin bloque se señala y el global no es PASS", () => {
    const rep = { testResults: [{ assertionResults: [passed("sin bloque")] }] };
    const s = summarize([rep], []); expect(s.unassigned).toBe(1); expect(s.overall).toBe("FAIL");
  });
  it("PASS global solo si B0–B9 tienen resultados y ninguno falla", () => {
    const all = BLOCKS.map((b) => passed(`${b}.1 x`));
    const s = summarize([{ testResults: [{ assertionResults: all }] }], []);
    expect(s.overall).toBe("PASS");
  });
});

// PRICESMART-API-06A — pruebas CONTRA MariaDB real efímera. SOLO se cargan desde el ejecutor (vitest.lab.config.mts); no coinciden con el patrón de `npm test`.
// Datos exclusivamente sintéticos. Cada título empieza por su bloque (B0…B8) para el resumen PASS/FAIL/SKIP. D01–D16 siguen PENDIENTES: lo que dependa de ellas se anota en el título.
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { sandboxPool } from "../../../src/lib/sandbox-db";
import { mariaDbOrderRepository, PersistenceError, type PayloadCipher } from "../../../src/lib/integrations/pricesmart/mariadb-repository";
import { OrderApplication } from "../../../src/lib/integrations/pricesmart/service";
import { OrderError, type Principal, type Scope } from "../../../src/lib/integrations/pricesmart/contracts";
import type { StoredOrder } from "../../../src/lib/integrations/pricesmart/ports";
import { adminOptions, assertAdminOptions } from "./safety.mjs";

const manifestPath = process.env.PS06A_MANIFEST;
if (!manifestPath || process.env.NOVALVION_ENV !== "sandbox") throw new Error("API-06A: esta suite solo se ejecuta desde el ejecutor del laboratorio.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { schema: string; user: string; port: number; pipe: string; datadir: string };
const phase = process.env.PS06A_PHASE ?? "";
const MAIN = phase === "main";
const T = `\`${manifest.schema}\``;

// ---- infraestructura de prueba
const KEY = randomBytes(32);
const cipher: PayloadCipher = {
  async seal(input, context) {
    const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", KEY, iv); c.setAAD(Buffer.from(context));
    const body = Buffer.concat([c.update(JSON.stringify(input), "utf8"), c.final()]);
    return { ciphertext: Buffer.concat([iv, c.getAuthTag(), body]), keyReference: "lab-key-1" };
  },
  async open(buf, keyReference, context) {
    if (keyReference !== "lab-key-1") throw new Error("clave desconocida");
    const d = createDecipheriv("aes-256-gcm", KEY, buf.subarray(0, 12)); d.setAAD(Buffer.from(context)); d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8"));
  },
};
const raw = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 8, multipleStatements: false });
const pool = sandboxPool(raw);
const repo = mariaDbOrderRepository(pool, { schema: manifest.schema, runtimeUser: manifest.user, cipher });
afterAll(async () => { await pool.end(); });

const scope = (tenantId = 1, clientId = 1, integrationId = "qa-integration"): Scope => ({ environment: "sandbox", tenantId, clientId, integrationId });
const principal = (tenantId = 1, clientId = 1, integrationId = "qa-integration", club = "QA-CLUB"): Principal =>
  ({ integrationId, tenantId, clientId, environment: "sandbox", originClubReference: club, scopes: ["orders:create", "orders:read", "orders:cancel"] });
const appFor = (p: Principal) => new OrderApplication({ resolve: async () => structuredClone(p) }, repo);
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const body = (id: string, club = "QA-CLUB") => ({ schemaVersion: "api01-draft-1", externalOrderId: id, originClubReference: club });
const uid = () => `L${randomBytes(6).toString("hex")}`;
const stored = (id: string, club = "QA-CLUB"): StoredOrder => {
  const sid = randomUUID();
  return { id: sid, input: { schemaVersion: "api01-draft-1", externalOrderId: id, originClubReference: club }, inputHash: createHash("sha256").update(id).digest("hex"), state: "RECEIVED", version: 1, correlationId: sid,
    receivedAt: new Date().toISOString(), receipt: { externalOrderId: id, provisionalStatus: "RECEIVED", processingStatus: "PENDING", version: 1, correlationId: sid }, cancellationHash: null, cancellationReceipt: null, cancellationReason: null, tmsLinked: false };
};
/** Lectura administrativa de SOLO SELECT por el pipe del run (otra conexión, para comprobar el estado confirmado). */
async function admin(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  if (!/^SELECT\s/i.test(sql) || sql.includes(";")) throw new Error("admin(): solo SELECT");
  const o = adminOptions(manifest); assertAdminOptions(o, manifest);
  const c = await mysql.createConnection(o);
  try { const [rows] = await c.query(sql, params); return rows as Record<string, unknown>[]; } finally { await c.end(); }
}
const count = async (table: string, where = "1=1", params: unknown[] = []) => Number((await admin(`SELECT COUNT(*) AS n FROM ${T}.${table} WHERE ${where}`, params))[0].n);
const byExternal = (id: string): [string, unknown[]] => ["external_order_id = ?", [Buffer.from(id)]];
async function runtimeConn() { return mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME }); }
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

describe.skipIf(!MAIN)("B0 aislamiento observado desde el proceso de pruebas", () => {
  it("B0.t1 entorno: loopback, puerto del run, nunca 3306", () => {
    expect(process.env.DB_HOST).toBe("127.0.0.1");
    expect(Number(process.env.DB_PORT)).toBe(manifest.port);
    expect([3306, 33060, 5432]).not.toContain(Number(process.env.DB_PORT));
    expect(process.env.DB_NAME).toBe(manifest.schema);
  });
  it("B0.t2 el servidor alcanzado es el del run (puerto, datadir, versión) y la cuenta es la mínima", async () => {
    const [[r]] = (await pool.query("SELECT @@port AS port, @@datadir AS datadir, @@version AS version, CURRENT_USER() AS account, DATABASE() AS db")) as unknown as [Record<string, unknown>[]];
    expect(Number(r.port)).toBe(manifest.port);
    expect(String(r.datadir).toLowerCase().replace(/[\\/]+$/, "")).toBe(manifest.datadir.toLowerCase().replace(/[\\/]+$/, ""));
    expect(String(r.version)).toMatch(/^11\.8\.9.*MariaDB/);
    expect(r.account).toBe(`${manifest.user}@127.0.0.1`);
    expect(r.db).toBe(manifest.schema);
  });
  it("B0.t3 la guardia de red impide alcanzar MySQL80 (:3306), PostgreSQL (:5432), hosts externos y fetch", () => {
    expect(() => net.createConnection(3306, "127.0.0.1")).toThrow(/prohibido/);
    expect(() => net.createConnection(5432, "127.0.0.1")).toThrow(/prohibido/);
    expect(() => net.createConnection(3306, "mysql.invalid")).toThrow(/prohibido/);
    expect(() => net.createConnection(manifest.port + 1, "127.0.0.1")).toThrow(/prohibido/);
    expect(() => fetch("https://example.invalid/")).toThrow(/prohibido/);
  });
});

describe.skipIf(!MAIN)("B1 DDL efectivo (information_schema)", () => {
  it("B1.1 las 6 tablas son InnoDB", async () => {
    const rows = await admin("SELECT TABLE_NAME AS t, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [manifest.schema]);
    expect(rows.map((r) => r.t)).toEqual(["novalvion_environment", "ps_api01_audit", "ps_api01_events", "ps_api01_orders", "ps_api01_outbox", "ps_api01_scopes"]);
    expect(rows.every((r) => r.e === "InnoDB")).toBe(true);
  });
  it("B1.2 CHECK de orders presentes (≥ 11) y UNIQUE de identidad con el orden de columnas del contrato", async () => {
    const checks = await admin("SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'ps_api01_orders'", [manifest.schema]);
    expect(Number(checks[0].n)).toBeGreaterThanOrEqual(11);
    const cols = await admin("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ps_api01_orders' AND INDEX_NAME = 'uq_ps_api01_identity' ORDER BY SEQ_IN_INDEX", [manifest.schema]);
    expect(cols.map((r) => r.c)).toEqual(["environment", "tenant_id", "client_id", "integration_id", "external_order_id"]);
  });
  it("B1.3 4 claves foráneas efectivas; identificadores externos son binarios", async () => {
    const fks = await admin("SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?", [manifest.schema]);
    expect(Number(fks[0].n)).toBe(4);
    const t = await admin("SELECT DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ps_api01_orders' AND COLUMN_NAME = 'external_order_id'", [manifest.schema]);
    expect(t[0].d).toBe("varbinary");
  });
  it("B1.4 los CHECK se APLICAN: estado inválido rechazado por el motor", async () => {
    const c = await runtimeConn();
    try {
      const id = randomUUID().replaceAll("-", "");
      const insert = (state: string) => c.query(
        `INSERT INTO ${T}.ps_api01_orders (id,environment,tenant_id,client_id,integration_id,external_order_id,origin_club_reference,payload_version,payload_ciphertext,payload_key_reference,input_hash,state,version,correlation_id,received_at,receipt_json,tms_linked) VALUES (UNHEX(?),'sandbox',1,1,'qa-integration',?,'QA-CLUB','api01-draft-1',?, 'k', UNHEX(?), ?, 1, UNHEX(?), UTC_TIMESTAMP(6), '{}', 0)`,
        [id, Buffer.from(uid()), Buffer.from("x"), "a".repeat(64), state, id]);
      await expect(insert("BOGUS")).rejects.toMatchObject({ code: "ER_CONSTRAINT_FAILED" });
    } finally { await c.end(); }
  });
});

describe.skipIf(!MAIN)("B2 persistencia básica con cifrado de prueba", () => {
  it("B2.1 recibir → leer: DURABLE, recibo original, eventos/outbox/auditoría atómicos; payload cifrado", async () => {
    const id = uid(); const app = appFor(principal());
    const r = await app.receive(bytes(body(id)));
    expect(r.durability).toBe("DURABLE"); expect(r.value).toMatchObject({ externalOrderId: id, provisionalStatus: "RECEIVED", processingStatus: "PENDING", version: 1 });
    const g = await app.get(id); expect(g.value).toMatchObject({ externalOrderId: id, version: 1 });
    expect(await count("ps_api01_orders", ...byExternal(id))).toBe(1);
    const row = (await admin(`SELECT HEX(id) AS id, LOCATE(?, payload_ciphertext) AS pos FROM ${T}.ps_api01_orders WHERE external_order_id = ?`, [Buffer.from(id), Buffer.from(id)]))[0];
    expect(Number(row.pos)).toBe(0);
    expect(await count("ps_api01_events", "order_id = UNHEX(?)", [row.id])).toBe(1);
    expect(await count("ps_api01_outbox", "order_id = UNHEX(?) AND status = 'PENDING'", [row.id])).toBe(1);
    expect(await count("ps_api01_audit", "order_id = UNHEX(?) AND operation = 'RECEIVE'", [row.id])).toBe(1);
    expect(await count("ps_api01_audit", "order_id = UNHEX(?) AND operation = 'READ'", [row.id])).toBe(1);
  });
  it("B2.2 cancelación: versión +1, evento y outbox nuevos, CAS por versión (D09 pendiente: motivo/método no ratificados)", async () => {
    const id = uid(); const app = appFor(principal()); await app.receive(bytes(body(id)));
    const c = await app.requestCancellation(id, bytes({ reason: "ORIGIN_REQUEST" }));
    expect(c.value).toMatchObject({ provisionalStatus: "CANCELLATION_REQUESTED", version: 2 });
    const oid = String((await admin(`SELECT HEX(id) AS id FROM ${T}.ps_api01_orders WHERE external_order_id = ?`, [Buffer.from(id)]))[0].id);
    expect(await count("ps_api01_events", "order_id = UNHEX(?)", [oid])).toBe(2);
    expect(await count("ps_api01_outbox", "order_id = UNHEX(?)", [oid])).toBe(2);
  });
});

describe.skipIf(!MAIN)("B3 idempotencia (D03/D10 pendientes: unicidad y política de replay no ratificadas)", () => {
  it("B3.1 mismo contenido dos veces (JSON reordenado) → mismo recibo, 1 orden/1 evento/1 outbox, auditoría CREATED+REPLAY", async () => {
    const id = uid(); const app = appFor(principal());
    const a = await app.receive(bytes(body(id)));
    const b = await app.receive(bytes({ originClubReference: "QA-CLUB", externalOrderId: id, schemaVersion: "api01-draft-1" }));
    expect(b.value).toEqual(a.value);
    const oid = String((await admin(`SELECT HEX(id) AS id FROM ${T}.ps_api01_orders WHERE external_order_id = ?`, [Buffer.from(id)]))[0].id);
    expect(await count("ps_api01_events", "order_id = UNHEX(?)", [oid])).toBe(1);
    expect(await count("ps_api01_outbox", "order_id = UNHEX(?)", [oid])).toBe(1);
    expect(await count("ps_api01_audit", "order_id = UNHEX(?) AND operation IN ('RECEIVE','REPLAY')", [oid])).toBe(2);
  });
  it("B3.2 mismo identificador con contenido distinto (otro club) → CONFLICT sin tocar la orden original", async () => {
    const id = uid(); await appFor(principal()).receive(bytes(body(id)));
    await expect(appFor(principal(1, 1, "qa-integration", "QA-CLUB-2")).receive(bytes(body(id, "QA-CLUB-2")))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await count("ps_api01_orders", ...byExternal(id))).toBe(1);
  });
  it("B3.3 cancelación repetida igual → mismo recibo (CANCEL_REPLAY); distinta → CONFLICT", async () => {
    const id = uid(); const app = appFor(principal()); await app.receive(bytes(body(id)));
    const a = await app.requestCancellation(id, bytes({ reason: "DUPLICATE" })); const b = await app.requestCancellation(id, bytes({ reason: "DUPLICATE" }));
    expect(b.value).toEqual(a.value);
    await expect(app.requestCancellation(id, bytes({ reason: "ORIGIN_REQUEST" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe.skipIf(!MAIN)("B4 concurrencia real (dos o más conexiones)", () => {
  it("B4.1 10 recepciones simultáneas iguales → exactamente 1 orden y el mismo recibo", async () => {
    const id = uid(); const app = appFor(principal());
    const results = await Promise.all(Array.from({ length: 10 }, () => app.receive(bytes(body(id)))));
    expect(new Set(results.map((r) => r.value.correlationId)).size).toBe(1);
    expect(await count("ps_api01_orders", ...byExternal(id))).toBe(1);
  });
  it("B4.2 recepciones simultáneas conflictivas (dos clubes) → 1 orden; el perdedor recibe CONFLICT", async () => {
    const id = uid(); const a = appFor(principal()); const b = appFor(principal(1, 1, "qa-integration", "QA-CLUB-2"));
    const settled = await Promise.allSettled([a.receive(bytes(body(id))), b.receive(bytes(body(id, "QA-CLUB-2"))), a.receive(bytes(body(id))), b.receive(bytes(body(id, "QA-CLUB-2")))]);
    expect(await count("ps_api01_orders", ...byExternal(id))).toBe(1);
    expect(settled.some((s) => s.status === "fulfilled")).toBe(true);
    expect(settled.filter((s) => s.status === "rejected").every((s) => (s as PromiseRejectedResult).reason instanceof OrderError && (s as PromiseRejectedResult).reason.code === "CONFLICT")).toBe(true);
  });
  it("B4.3 espera de bloqueo vencida (innodb_lock_wait_timeout=3) → PersistenceError RETRYABLE", async () => {
    const id = uid(); await appFor(principal()).receive(bytes(body(id)));
    const holder = await runtimeConn();
    try {
      await holder.beginTransaction();
      await holder.query(`SELECT id FROM ${T}.ps_api01_orders WHERE external_order_id = ? FOR UPDATE`, [Buffer.from(id)]);
      const started = Date.now();
      await expect(repo.runAtomic(scope(), (tx) => tx.findForUpdate(id))).rejects.toMatchObject({ code: "RETRYABLE" });
      expect(Date.now() - started).toBeGreaterThanOrEqual(2500);
    } finally { await holder.rollback().catch(() => {}); await holder.end(); }
  });
  it("B4.4 interbloqueo inducido → una transacción víctima RETRYABLE y la otra confirma", async () => {
    const A = uid(); const B = uid(); const app = appFor(principal()); await app.receive(bytes(body(A))); await app.receive(bytes(body(B)));
    const g1 = deferred(); const g2 = deferred();
    const t1 = repo.runAtomic(scope(), async (tx) => { await tx.findForUpdate(A); g1.resolve(); await g2.promise; await tx.findForUpdate(B); return "t1"; });
    const t2 = repo.runAtomic(scope(), async (tx) => { await tx.findForUpdate(B); g2.resolve(); await g1.promise; await tx.findForUpdate(A); return "t2"; });
    const settled = await Promise.allSettled([t1, t2]);
    const rejected = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(PersistenceError); expect(rejected[0].reason.code).toBe("RETRYABLE");
  });
});

describe.skipIf(!MAIN)("B5 aislamiento multiempresa (el motor no separa inquilinos: lo hace el adaptador con el alcance completo)", () => {
  it("B5.1 el mismo identificador externo existe de forma independiente en 4 alcances y cada lectura devuelve la propia orden", async () => {
    const id = uid(); const scopes: [number, number, string][] = [[1, 1, "qa-integration"], [1, 2, "qa-integration"], [2, 1, "qa-integration"], [1, 1, "qa-other"]];
    const receipts = [];
    for (const [t, c, i] of scopes) receipts.push((await appFor(principal(t, c, i)).receive(bytes(body(id)))).value.correlationId);
    expect(new Set(receipts).size).toBe(4);
    expect(await count("ps_api01_orders", ...byExternal(id))).toBe(4);
    for (const [k, [t, c, i]] of scopes.entries()) expect((await appFor(principal(t, c, i)).get(id)).value.correlationId).toBe(receipts[k]);
  });
  it("B5.2 una orden de otro alcance es invisible (NOT_FOUND) y no se puede cancelar", async () => {
    const id = uid(); await appFor(principal(1, 1)).receive(bytes(body(id)));
    await expect(appFor(principal(2, 1)).get(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(appFor(principal(2, 1)).requestCancellation(id, bytes({ reason: "DUPLICATE" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(appFor(principal(1, 1, "qa-integration", "QA-CLUB-2")).get(id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("B5.3 alcance NO registrado → el motor lo rechaza (FK), sin filas parciales", async () => {
    const id = uid();
    await expect(repo.runAtomic(scope(9, 9, "qa-unregistered"), async (tx) => { await tx.insert(stored(id)); })).rejects.toBeInstanceOf(PersistenceError);
    expect(await count("ps_api01_orders", ...byExternal(id))).toBe(0);
  });
});

describe.skipIf(!MAIN)("B6 atomicidad y rollback real", () => {
  it("B6.1 fallo posterior al INSERT revierte todo", async () => {
    const o = stored(uid());
    await expect(repo.runAtomic(scope(), async (tx) => {
      await tx.insert(o); await tx.appendEvent({ orderId: o.id, version: 1, type: "RECEIVED", reason: null, correlationId: o.correlationId });
      await tx.enqueue({ orderId: o.id, version: 1, type: "RECEIVED", reason: null, correlationId: o.correlationId });
      await tx.appendAudit({ operation: "RECEIVE", result: "CREATED", orderId: o.id, correlationId: o.correlationId });
      throw new Error("fallo inyectado");
    })).rejects.toBeInstanceOf(PersistenceError);
    expect(await count("ps_api01_orders", "id = UNHEX(?)", [o.id.replaceAll("-", "")])).toBe(0);
    for (const t of ["ps_api01_events", "ps_api01_outbox", "ps_api01_audit"]) expect(await count(t, "order_id = UNHEX(?)", [o.id.replaceAll("-", "")])).toBe(0);
  });
  it("B6.2 evento duplicado (PK) tras insertar la orden revierte la orden", async () => {
    const o = stored(uid()); const ev = { orderId: o.id, version: 1, type: "RECEIVED" as const, reason: null, correlationId: o.correlationId };
    await expect(repo.runAtomic(scope(), async (tx) => { await tx.insert(o); await tx.appendEvent(ev); await tx.appendEvent(ev); })).rejects.toBeInstanceOf(PersistenceError);
    expect(await count("ps_api01_orders", "id = UNHEX(?)", [o.id.replaceAll("-", "")])).toBe(0);
  });
  it("B6.3 auditoría con orden inexistente (FK) revierte la orden; el servicio sigue operativo después", async () => {
    const o = stored(uid());
    await expect(repo.runAtomic(scope(), async (tx) => { await tx.insert(o); await tx.appendAudit({ operation: "RECEIVE", result: "CREATED", orderId: randomUUID(), correlationId: o.correlationId }); })).rejects.toBeInstanceOf(PersistenceError);
    expect(await count("ps_api01_orders", "id = UNHEX(?)", [o.id.replaceAll("-", "")])).toBe(0);
    const id = uid(); expect((await appFor(principal()).receive(bytes(body(id)))).durability).toBe("DURABLE");
  });
});

describe.skipIf(!MAIN)("B8 privilegios efectivos de la cuenta de ejecución", () => {
  it("B8.1 denegaciones: DELETE, UPDATE de eventos/columnas protegidas, DDL, scopes, esquemas ajenos", async () => {
    const c = await runtimeConn();
    try {
      const denied = async (sql: string, errno: number[]) => { await expect(c.query(sql)).rejects.toSatisfy((e: { errno?: number }) => errno.includes(e.errno ?? 0)); };
      await denied(`DELETE FROM ${T}.ps_api01_orders WHERE 1=0`, [1142]);
      await denied(`UPDATE ${T}.ps_api01_events SET reason = NULL WHERE 1=0`, [1142]);
      await denied(`UPDATE ${T}.ps_api01_orders SET external_order_id = external_order_id WHERE 1=0`, [1143, 1142]);
      await denied(`UPDATE ${T}.ps_api01_outbox SET status = 'DONE' WHERE 1=0`, [1142]);
      await denied(`DROP TABLE ${T}.ps_api01_audit`, [1142]);
      await denied(`CREATE TABLE ${T}.intruso (id INT)`, [1142]);
      await denied(`TRUNCATE TABLE ${T}.ps_api01_orders`, [1142]);
      await denied(`SELECT * FROM ${T}.ps_api01_scopes`, [1142]);
      await denied("SELECT * FROM mysql.user", [1142, 1044]);
      await denied("CREATE DATABASE intruso", [1044]);
      await denied("USE mysql", [1044]);
    } finally { await c.end(); }
  });
  it("B8.2 SHOW GRANTS: sin ALL PRIVILEGES, sin GRANT OPTION, solo el esquema del laboratorio", async () => {
    const c = await runtimeConn();
    try {
      const [rows] = await c.query("SHOW GRANTS FOR CURRENT_USER()");
      const text = (rows as Record<string, string>[]).map((r) => Object.values(r)[0]).join("\n");
      expect(text).not.toMatch(/ALL PRIVILEGES|GRANT OPTION|SUPER|FILE|PROCESS/);
      for (const line of text.split("\n")) if (!/^GRANT USAGE ON \*\.\*/.test(line)) expect(line).toContain(manifest.schema);
    } finally { await c.end(); }
  });
});

// ---- B7 recuperación ante caída dura (el ejecutor mata el PID verificado y reinicia sobre el MISMO datadir)
const COMMITTED = "CRASH-COMMITTED"; const INFLIGHT = "CRASH-INFLIGHT";
describe.skipIf(phase !== "crash-prepare")("B7 preparación de la caída", () => {
  it("B7.1 confirma una orden y deja otra EN VUELO; el ejecutor derriba el servidor", async () => {
    const app = appFor(principal());
    const ack = await app.receive(bytes(body(COMMITTED))); expect(ack.durability).toBe("DURABLE");
    const o = stored(INFLIGHT); let outcome = "sin-error";
    try {
      await repo.runAtomic(scope(), async (tx) => {
        await tx.insert(o); await tx.appendEvent({ orderId: o.id, version: 1, type: "RECEIVED", reason: null, correlationId: o.correlationId });
        writeFileSync(process.env.PS06A_CRASH_READY!, JSON.stringify({ at: new Date().toISOString() }));
        for (let i = 0; i < 300; i++) { await new Promise((r) => setTimeout(r, 200)); await tx.findForUpdate(INFLIGHT); }
      });
    } catch (e) { outcome = `${(e as Error).constructor.name}:${(e as { code?: string }).code ?? ""}`; }
    writeFileSync(`${process.env.PS06A_CRASH_READY}.result`, JSON.stringify({ committedAck: true, inflightOutcome: outcome }));
    expect(outcome).not.toBe("sin-error");
  });
});
describe.skipIf(phase !== "crash-verify")("B7 verificación tras la caída y el reinicio", () => {
  it("B7.2 la orden confirmada persiste completa (orden+evento+outbox+auditoría) y es legible", async () => {
    const oid = String((await admin(`SELECT HEX(id) AS id FROM ${T}.ps_api01_orders WHERE external_order_id = ?`, [Buffer.from(COMMITTED)]))[0].id);
    expect(await count("ps_api01_events", "order_id = UNHEX(?)", [oid])).toBe(1);
    expect(await count("ps_api01_outbox", "order_id = UNHEX(?)", [oid])).toBe(1);
    expect(await count("ps_api01_audit", "order_id = UNHEX(?)", [oid])).toBe(1);
    expect((await appFor(principal()).get(COMMITTED)).value.externalOrderId).toBe(COMMITTED);
  });
  it("B7.3 la transacción en vuelo desapareció sin dejar filas huérfanas", async () => {
    expect(await count("ps_api01_orders", ...byExternal(INFLIGHT))).toBe(0);
    expect(await count("ps_api01_events", "order_version = 1 AND order_id NOT IN (SELECT id FROM " + T + ".ps_api01_orders)")).toBe(0);
  });
  it("B7.4 el servicio acepta nuevas operaciones tras la recuperación", async () => {
    expect((await appFor(principal()).receive(bytes(body(uid())))).durability).toBe("DURABLE");
  });
  it.skip("B7.5 caída DURANTE el COMMIT (COMMIT_UNKNOWN real): no determinista con este arnés; solo cubierta con doble en API-02", () => {});
});

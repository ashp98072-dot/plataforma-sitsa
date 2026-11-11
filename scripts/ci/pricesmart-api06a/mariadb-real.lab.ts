// PRICESMART-API-06A — pruebas CONTRA MariaDB real efímera. SOLO se cargan desde el ejecutor (vitest.lab.config.mts); no coinciden con el patrón de `npm test`.
// Datos exclusivamente sintéticos. Cada título empieza por su bloque (B0…B8) para el resumen PASS/FAIL/SKIP. D01–D16 siguen PENDIENTES: lo que dependa de ellas se anota en el título.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { sandboxPool } from "../../../src/lib/sandbox-db";
import { mariaDbOrderRepository, PersistenceError } from "../../../src/lib/integrations/pricesmart/mariadb-repository";
import { OrderApplication } from "../../../src/lib/integrations/pricesmart/service";
import { mariaDbAdaptationRepository } from "../../../src/lib/integrations/pricesmart/adaptation-mariadb";
import { mariaDbSourceOrderPort } from "../../../src/lib/integrations/pricesmart/source-order-mariadb";
import { createMariaDbSimulatedBridge, createSyntheticCandidateResolver } from "../../../src/lib/integrations/pricesmart/outbox-bridge";
import { createTmsAdaptation } from "../../../src/lib/integrations/pricesmart/tms-adaptation";
import type { AdaptationCommand, AdaptationScope, CandidateResolutionPort, LogisticsCandidate } from "../../../src/lib/integrations/pricesmart/tms-adaptation-contracts";
import { mariaDbOutboxStore } from "../../../src/lib/integrations/pricesmart/outbox-mariadb";
import { DEFAULT_OUTBOX_POLICY, OutboxDispatcher, type OutboxClaim, type OutboxHandler, type OutboxStore } from "../../../src/lib/integrations/pricesmart/outbox";
import { OrderError, type Principal, type Scope } from "../../../src/lib/integrations/pricesmart/contracts";
import type { StoredOrder } from "../../../src/lib/integrations/pricesmart/ports";
import { adminOptions, assertAdminOptions } from "./safety.mjs";
import { makeLabCipher } from "./lab-cipher";

const manifestPath = process.env.PS06A_MANIFEST;
if (!manifestPath || process.env.NOVALVION_ENV !== "sandbox") throw new Error("API-06A: esta suite solo se ejecuta desde el ejecutor del laboratorio.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { schema: string; user: string; workerUser: string; port: number; pipe: string; datadir: string };
const phase = process.env.PS06A_PHASE ?? "";
const MAIN = phase === "main";
const T = `\`${manifest.schema}\``;

// ---- infraestructura de prueba
// Cifrador de laboratorio con clave derivada de AUTH_SECRET del run: estable entre las fases (procesos) de B7. Ver lab-cipher.ts.
const cipher = makeLabCipher(process.env.AUTH_SECRET);
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
  it("B1.1 las 9 tablas son InnoDB", async () => {
    const rows = await admin("SELECT TABLE_NAME AS t, ENGINE AS e FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME", [manifest.schema]);
    expect(rows.map((r) => r.t)).toEqual(["novalvion_environment", "ps_api01_audit", "ps_api01_events", "ps_api01_orders", "ps_api01_outbox", "ps_api01_scopes", "ps_api09_adapt_jobs", "ps_api09_adapt_links", "ps_api09_adapt_traces"]);
    expect(rows.every((r) => r.e === "InnoDB")).toBe(true);
  });
  it("B1.2 CHECK de orders presentes (≥ 11) y UNIQUE de identidad con el orden de columnas del contrato", async () => {
    const checks = await admin("SELECT COUNT(*) AS n FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'ps_api01_orders'", [manifest.schema]);
    expect(Number(checks[0].n)).toBeGreaterThanOrEqual(11);
    const cols = await admin("SELECT COLUMN_NAME AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'ps_api01_orders' AND INDEX_NAME = 'uq_ps_api01_identity' ORDER BY SEQ_IN_INDEX", [manifest.schema]);
    expect(cols.map((r) => r.c)).toEqual(["environment", "tenant_id", "client_id", "integration_id", "external_order_id"]);
  });
  it("B1.3 10 claves foráneas efectivas (4 de API-01 + 6 de API-09); identificadores externos son binarios", async () => {
    const fks = await admin("SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ?", [manifest.schema]);
    expect(Number(fks[0].n)).toBe(10);
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
      // MariaDB 4025 = ER_CONSTRAINT_FAILED, pero mysql2 traduce el errno 4025 con el nombre de MySQL (ER_INNODB_AUTOEXTEND_SIZE_OUT_OF_RANGE): se comprueba el errno y el mensaje, no el nombre.
      await expect(insert("BOGUS")).rejects.toSatisfy((e: { errno?: number; sqlMessage?: string }) => e.errno === 4025 && /CONSTRAINT .* failed/.test(e.sqlMessage ?? ""));
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

// ---- B10 outbox (API-07): almacén MariaDB y despachador contra el motor REAL, con una cuenta de WORKER separada (privilegios mínimos).
// Los eventos nacen del adaptador real (receive/cancel → ps_api01_outbox). La base es compartida con B1–B8, así que cada prueba trabaja SOLO con sus órdenes (claimMine) y devuelve lo ajeno
// con retry(0) para no depender del orden de las pruebas. Las esperas de lease usan el reloj de la base (lease mínima 1 s).
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const workerPools: ReturnType<typeof sandboxPool>[] = [];
afterAll(async () => { await Promise.all(workerPools.map((p) => p.end())); });
function workerPool() {
  const raw = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: manifest.workerUser, password: process.env.PS06A_WORKER_PASSWORD, database: manifest.schema, connectionLimit: 4 });
  const facade = sandboxPool(raw); workerPools.push(facade); return facade;
}
function workerStore(): OutboxStore { return mariaDbOutboxStore(workerPool(), { schema: manifest.schema, workerUser: manifest.workerUser }); }
const hexToUuid = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toLowerCase();
const uuidHex = (u: string) => u.replaceAll("-", "");
async function orderIdOf(externalId: string, tenant = 1, client = 1) {
  const rows = await admin(`SELECT HEX(id) AS id FROM ${T}.ps_api01_orders WHERE external_order_id = ? AND tenant_id = ? AND client_id = ?`, [Buffer.from(externalId), tenant, client]);
  return hexToUuid(String(rows[0].id));
}
async function outboxRow(orderId: string, version = 1) {
  const rows = await admin(`SELECT status, attempts, (lease_until IS NOT NULL AND lease_until > UTC_TIMESTAMP(6)) AS leased, (next_attempt_at <= UTC_TIMESTAMP(6)) AS due FROM ${T}.ps_api01_outbox WHERE order_id = UNHEX(?) AND order_version = ?`, [uuidHex(orderId), version]);
  return rows[0] as { status: string; attempts: number; leased: number; due: number };
}
/** Reclama hasta encontrar los eventos propios (clave orderId:version); lo ajeno se devuelve inmediatamente a PENDING. */
async function claimMine(store: OutboxStore, mine: Set<string>, leaseMs = 30_000, maxRounds = 6): Promise<OutboxClaim[]> {
  const found: OutboxClaim[] = [];
  for (let round = 0; round < maxRounds && found.length < mine.size; round++) {
    const batch = await store.claim(100, leaseMs);
    for (const c of batch) { if (mine.has(`${c.event.orderId}:${c.event.version}`)) found.push(c); else await store.retry(c, 0); }
    if (batch.length === 0) break;
  }
  return found;
}
async function seedOrders(prefix: string, n: number, p: Principal = principal()) {
  const ids: string[] = []; const app = appFor(p);
  for (let i = 0; i < n; i++) { const ext = `${prefix}${i}${uid()}`; await app.receive(bytes(body(ext, p.originClubReference))); ids.push(await orderIdOf(ext, p.tenantId, p.clientId)); }
  return ids;
}

describe.skipIf(!MAIN)("B10 outbox contra el motor real (API-07)", () => {
  it("B10.1 claim: reclama los eventos propios con lease (LEASED, attempts=1, vencimiento futuro) y los reconstruye con alcance, club y tipo correctos", async () => {
    const ids = await seedOrders("O1", 3); const mine = new Set(ids.map((i) => `${i}:1`)); const claims = await claimMine(workerStore(), mine);
    expect(claims).toHaveLength(3);
    for (const c of claims) {
      expect(c.attempt).toBe(1);
      expect(c.event).toMatchObject({ type: "RECEIVED", reason: null, version: 1, scope: { environment: "sandbox", tenantId: 1, clientId: 1, integrationId: "qa-integration", originClubReference: "QA-CLUB" } });
      expect(await outboxRow(c.event.orderId)).toMatchObject({ status: "LEASED", attempts: 1, leased: 1 });
    }
    expect(new Set(claims.map((c) => c.event.orderId))).toEqual(new Set(ids));
  });
  it("B10.2 exclusividad real: dos despachadores concurrentes reclaman lotes DISJUNTOS y ninguno espera al otro (SKIP LOCKED)", async () => {
    await seedOrders("O2", 12); const a = workerStore(); const b = workerStore();
    const started = Date.now(); const [x, y] = await Promise.all([a.claim(5, 30_000), b.claim(5, 30_000)]);
    expect(Date.now() - started).toBeLessThan(2_500);   // el lock wait de la base es de 3 s: si uno esperara al otro lo superaría
    expect(x).toHaveLength(5); expect(y).toHaveLength(5);
    const keys = [...x, ...y].map((c) => `${c.event.orderId}:${c.event.version}`); expect(new Set(keys).size).toBe(10);
    for (const c of [...x, ...y]) expect(await a.retry(c, 0) || await b.retry(c, 0)).toBe(true);   // se devuelven
  });
  it("B10.3 fencing real: tras vencer la lease otro worker reclama (attempt 2); el worker rezagado NO puede cerrar ni reabrir el evento", async () => {
    const [orderId] = await seedOrders("O3", 1); const mine = new Set([`${orderId}:1`]); const A = workerStore(); const B = workerStore();
    const [c1] = await claimMine(A, mine, 1_000); expect(c1.attempt).toBe(1);
    await sleep(1_600);
    const [c2] = await claimMine(B, mine, 30_000); expect(c2.attempt).toBe(2);
    expect(await A.complete(c1)).toBe(false); expect(await A.retry(c1, 0)).toBe(false); expect(await A.review(c1)).toBe(false);
    expect(await outboxRow(orderId)).toMatchObject({ status: "LEASED", attempts: 2 });
    expect(await B.complete(c2)).toBe(true); expect(await outboxRow(orderId)).toMatchObject({ status: "DONE", attempts: 2, leased: 0 });
    expect(await B.complete(c2)).toBe(false);   // ya no está LEASED
    expect((await claimMine(B, mine, 1_000)).length).toBe(0);   // lo cerrado no se reclama
  });
  it("B10.4 retry: vuelve a PENDING con espera (no se reclama antes de tiempo) y se reclama después con attempts=2", async () => {
    const [orderId] = await seedOrders("O4", 1); const mine = new Set([`${orderId}:1`]); const W = workerStore();
    const [c1] = await claimMine(W, mine); expect(await W.retry(c1, 1_500)).toBe(true);
    expect(await outboxRow(orderId)).toMatchObject({ status: "PENDING", attempts: 1, leased: 0, due: 0 });
    expect((await claimMine(W, mine, 30_000, 1)).length).toBe(0);   // UNA sola ronda: varias rondas con filas ajenas tardan más que la espera y el evento vencería durante la comprobación
    await sleep(1_900); const [c2] = await claimMine(W, mine); expect(c2.attempt).toBe(2); expect(await W.complete(c2)).toBe(true);
  });
  it("B10.5 review: pasa a REVIEW durable y NUNCA se vuelve a reclamar, ni al vencer el tiempo", async () => {
    const [orderId] = await seedOrders("O5", 1); const mine = new Set([`${orderId}:1`]); const W = workerStore();
    const [c1] = await claimMine(W, mine, 1_000); expect(await W.review(c1)).toBe(true);
    await sleep(1_300); expect((await claimMine(W, mine)).length).toBe(0); expect(await outboxRow(orderId)).toMatchObject({ status: "REVIEW", attempts: 1, leased: 0 });
  });
  it("B10.6 despachador de punta a punta: DONE de recepción y cancelación (2 eventos) y REVIEW durable al agotar los intentos", async () => {
    const [orderId] = await seedOrders("O6", 1); const ext = (await admin(`SELECT external_order_id AS e FROM ${T}.ps_api01_orders WHERE id = UNHEX(?)`, [uuidHex(orderId)]))[0].e;
    await appFor(principal()).requestCancellation(Buffer.from(ext as Buffer).toString("utf8"), bytes({ reason: "ORIGIN_REQUEST" }));
    const seen: string[] = []; const handler: OutboxHandler = { handle: async (e) => { if (e.orderId === orderId) seen.push(`${e.type}:${e.version}:${e.reason}`); return { kind: "DONE" }; } };
    const policy = { ...DEFAULT_OUTBOX_POLICY, batchSize: 100, maxAttempts: 2, backoffBaseMs: 1, backoffMaxMs: 1 };
    const summary = await new OutboxDispatcher(workerStore(), handler, policy).runOnce();
    expect(summary.done).toBeGreaterThanOrEqual(2); expect(summary.unrecorded).toBe(0); expect(summary.lostLease).toBe(0);
    expect(seen.sort()).toEqual(["CANCELLATION_REQUESTED:2:ORIGIN_REQUEST", "RECEIVED:1:null"]);
    expect(await outboxRow(orderId, 1)).toMatchObject({ status: "DONE", attempts: 1 }); expect(await outboxRow(orderId, 2)).toMatchObject({ status: "DONE", attempts: 1 });
    // agotar intentos: el handler siempre pide reintento para una orden concreta
    const [other] = await seedOrders("O6b", 1); const logs: string[] = [];
    const always: OutboxHandler = { handle: async (e) => (e.orderId === other ? { kind: "RETRY", reason: "DEPENDENCY_DOWN" } : { kind: "DONE" }) };
    const d = new OutboxDispatcher(workerStore(), always, policy, (l) => { if (l.orderId === other) logs.push(`${l.outcome}:${l.code}`); });
    await d.runOnce(); await sleep(250); await d.runOnce();
    expect(logs).toEqual(["RETRY:DEPENDENCY_DOWN", "REVIEW:MAX_ATTEMPTS"]); expect(await outboxRow(other)).toMatchObject({ status: "REVIEW", attempts: 2 });
    expect(await count("ps_api01_orders", "id = UNHEX(?)", [uuidHex(other)])).toBe(1);   // la orden aceptada sigue intacta
  });
  it("B10.7 privilegios efectivos de la cuenta de WORKER: solo lee la cola y escribe 4 columnas; sin payload, sin INSERT/DELETE, sin DDL", async () => {
    const c = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: manifest.workerUser, password: process.env.PS06A_WORKER_PASSWORD, database: manifest.schema });
    try {
      const denied = async (sql: string, errno: number[]) => { await expect(c.query(sql)).rejects.toSatisfy((e: { errno?: number }) => errno.includes(e.errno ?? 0)); };
      await c.query(`SELECT status, attempts FROM ${T}.ps_api01_outbox LIMIT 1`);   // permitido
      await c.query(`UPDATE ${T}.ps_api01_outbox SET status = status WHERE 1=0`);    // permitido (columna concedida)
      await denied(`UPDATE ${T}.ps_api01_outbox SET order_id = order_id WHERE 1=0`, [1143, 1142]);
      await denied(`DELETE FROM ${T}.ps_api01_outbox WHERE 1=0`, [1142]);
      await denied(`INSERT INTO ${T}.ps_api01_outbox (status) VALUES ('PENDING')`, [1142, 1143]);
      await denied(`UPDATE ${T}.ps_api01_events SET reason = reason WHERE 1=0`, [1142, 1143]);
      await denied(`SELECT payload_ciphertext FROM ${T}.ps_api01_orders LIMIT 1`, [1143, 1142]);
      await denied(`SELECT receipt_json FROM ${T}.ps_api01_orders LIMIT 1`, [1143, 1142]);
      await denied(`SELECT * FROM ${T}.ps_api01_audit`, [1142]);
      await denied(`SELECT * FROM ${T}.ps_api01_scopes`, [1142]);
      await denied(`DROP TABLE ${T}.ps_api01_outbox`, [1142]);
      await denied(`CREATE TABLE ${T}.intruso (id INT)`, [1142]);
      await denied("SELECT * FROM mysql.user", [1142, 1044]);
      await denied("USE mysql", [1044]);
      const [rows] = await c.query("SHOW GRANTS FOR CURRENT_USER()");
      const text = (rows as Record<string, string>[]).map((r) => Object.values(r)[0]).join("\n");
      expect(text).not.toMatch(/ALL PRIVILEGES|GRANT OPTION|DELETE|DROP|CREATE|ALTER|SUPER|FILE|PROCESS/);
      for (const line of text.split("\n").filter((l) => /INSERT/.test(l))) expect(line).toMatch(/ps_api09_adapt_(jobs|links|traces)/);   // API-09: INSERT solo en el diario de adaptación; ninguno sobre la outbox, eventos u órdenes
      for (const line of text.split("\n")) if (!/^GRANT USAGE ON \*\.\*/.test(line)) expect(line).toContain(manifest.schema);
    } finally { await c.end(); }
  });
  it("B10.8 multiempresa: cada evento reclamado conserva su propio alcance y club, también con el mismo identificador externo", async () => {
    const ext = `O8${uid()}`; const pa = principal(1, 1, "qa-integration", "QA-CLUB"); const pb = principal(2, 1, "qa-integration", "QA-CLUB"); const pc = principal(1, 1, "qa-integration", "QA-CLUB-2");
    await appFor(pa).receive(bytes(body(ext))); await appFor(pb).receive(bytes(body(ext))); await appFor(pc).receive(bytes(body(`${ext}c`, "QA-CLUB-2")));
    const a = await orderIdOf(ext, 1, 1); const b = await orderIdOf(ext, 2, 1); const c = await orderIdOf(`${ext}c`, 1, 1);
    const claims = await claimMine(workerStore(), new Set([`${a}:1`, `${b}:1`, `${c}:1`])); const byOrder = new Map(claims.map((x) => [x.event.orderId, x.event.scope]));
    expect(byOrder.size).toBe(3); expect(a).not.toBe(b);
    expect(byOrder.get(a)).toMatchObject({ tenantId: 1, clientId: 1, originClubReference: "QA-CLUB" });
    expect(byOrder.get(b)).toMatchObject({ tenantId: 2, clientId: 1, originClubReference: "QA-CLUB" });
    expect(byOrder.get(c)).toMatchObject({ tenantId: 1, clientId: 1, originClubReference: "QA-CLUB-2" });
  });
});

// ---- B11 adaptación durable (API-09): diario de adaptación, lectura de órdenes y puente SIMULATED contra el motor REAL, con la cuenta de WORKER (privilegios mínimos).
// El puente sigue sin crear solicitudes/viajes/entregas del TMS: el resolutor es sintético y el esquema no tiene columna de id de TMS.
const aScope = (tenantId = 1, club = "QA-CLUB"): AdaptationScope => ({ environment: "sandbox", tenantId, clientId: 1, integrationId: "qa-integration", originClubReference: club });
const adaptRepo = (pool = workerPool()) => mariaDbAdaptationRepository(pool, { schema: manifest.schema, account: manifest.workerUser });
const adaptSource = (pool = workerPool()) => mariaDbSourceOrderPort(pool, { schema: manifest.schema, account: manifest.workerUser });
function adaptationFor(nowMs: () => number, resolver: CandidateResolutionPort = createSyntheticCandidateResolver(), leaseMs = 10_000) {
  const pool = workerPool(); return createTmsAdaptation({ source: adaptSource(pool), resolver, repository: adaptRepo(pool), nowMs }, leaseMs);
}
const dashed = (hex: string) => hexToUuid(hex.toLowerCase());
const cmdReceive = async (orderId: string): Promise<AdaptationCommand> => ({ kind: "RECEIVE", orderId, sourceVersion: 1, correlationId: dashed(String((await admin(`SELECT HEX(correlation_id) AS c FROM ${T}.ps_api01_orders WHERE id = UNHEX(?)`, [uuidHex(orderId)]))[0].c)) });
const linkRowOf = async (orderId: string) => (await admin(`SELECT request_reference AS r, local_delivery_state AS s, cancellation_requested AS c, version AS v, source_state AS ss FROM ${T}.ps_api09_adapt_links WHERE order_id = UNHEX(?)`, [uuidHex(orderId)]))[0];
const jobsOf = (orderId: string) => admin(`SELECT status, attempt, version FROM ${T}.ps_api09_adapt_jobs WHERE order_id = UNHEX(?) ORDER BY job_key`, [uuidHex(orderId)]);
const tracesOf = async (orderId: string) => (await admin(`SELECT phase, attempt, failure FROM ${T}.ps_api09_adapt_traces WHERE order_id = UNHEX(?) ORDER BY seq`, [uuidHex(orderId)])).map((r) => `${r.phase}:${r.attempt}:${r.failure ?? "-"}`);

describe.skipIf(!MAIN)("B11 adaptación durable contra el motor real (API-09)", () => {
  it("B11.1 puente de punta a punta: recepción y cancelación quedan en el diario (trabajos DONE, vínculo, bitácora) sin crear nada en el TMS", async () => {
    const [a, b] = await seedOrders("P1", 2);
    const extB = String((await admin(`SELECT external_order_id AS e FROM ${T}.ps_api01_orders WHERE id = UNHEX(?)`, [uuidHex(b)]))[0].e);
    await appFor(principal()).requestCancellation(extB, bytes({ reason: "ORIGIN_REQUEST" }));
    const bridge = createMariaDbSimulatedBridge({ pool: workerPool(), schema: manifest.schema, workerUser: manifest.workerUser, nowMs: Date.now, policy: { ...DEFAULT_OUTBOX_POLICY, batchSize: 100, backoffBaseMs: 1, backoffMaxMs: 1 } });
    expect(bridge.mode).toBe("SIMULATED");
    for (let i = 0; i < 10 && !((await linkRowOf(a)) && (await linkRowOf(b))); i++) await bridge.runOnce();
    expect(await linkRowOf(a)).toMatchObject({ s: "LOGISTICS_REVIEW", c: 0, ss: "RECEIVED" }); expect(String((await linkRowOf(a)).r)).toBe(`synthetic:${a}`);
    expect(await linkRowOf(b)).toMatchObject({ s: "CANCELLATION_REVIEW", c: 1, ss: "CANCELLATION_REQUESTED" });
    expect((await jobsOf(a)).map((j) => j.status)).toEqual(["DONE"]); expect((await jobsOf(b)).map((j) => j.status)).toEqual(["DONE", "DONE"]);
    expect(await tracesOf(a)).toEqual(["STARTED:1:-", "SUCCEEDED:1:-"]);
    expect(await outboxRow(a, 1)).toMatchObject({ status: "DONE" }); expect(await outboxRow(b, 2)).toMatchObject({ status: "DONE" });
    const orders = await admin(`SELECT state, tms_linked AS t FROM ${T}.ps_api01_orders WHERE id IN (UNHEX(?), UNHEX(?)) ORDER BY state`, [uuidHex(a), uuidHex(b)]);
    expect(orders.map((o) => `${o.state}:${o.t}`)).toEqual(["CANCELLATION_REQUESTED:0", "RECEIVED:0"]);   // la orden de origen no cambia; nada enlazado al TMS
    const cols = await admin("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE 'ps_api09_adapt_%' AND COLUMN_NAME LIKE '%tms%'", [manifest.schema]);
    expect(cols).toHaveLength(0);
  });
  it("B11.2 idempotencia: repetir el mismo comando devuelve el resultado guardado (replay), sin duplicar trabajo ni vínculo, y deja una traza REPLAY", async () => {
    const [id] = await seedOrders("P2", 1); const adaptation = adaptationFor(Date.now); const command = await cmdReceive(id);
    const first = await adaptation.process(aScope(), command); const again = await adaptation.process(aScope(), command);
    expect(first.replayed).toBe(false); expect(again.replayed).toBe(true); expect(again.value).toEqual(first.value);
    expect(await jobsOf(id)).toHaveLength(1); expect(await tracesOf(id)).toEqual(["STARTED:1:-", "SUCCEEDED:1:-", "REPLAY:1:-"]); expect((await linkRowOf(id)).v).toBe(1);
  });
  it("B11.3 concurrencia: dos procesos adaptan la MISMA orden a la vez → exactamente uno gana, el otro recibe CONFLICT, un solo vínculo y una sola referencia", async () => {
    const [id] = await seedOrders("P3", 1); const command = await cmdReceive(id);
    const slow: CandidateResolutionPort = { resolve: async (c: LogisticsCandidate) => { await sleep(400); return createSyntheticCandidateResolver().resolve(c); } };
    const results = await Promise.allSettled([adaptationFor(Date.now, slow).process(aScope(), command), adaptationFor(Date.now, slow).process(aScope(), command)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // El perdedor NO ejecuta nada: CONFLICT (vio el trabajo ya reclamado) o UNAVAILABLE (víctima de interbloqueo al crear el MISMO trabajo a la vez; reintentable por diseño).
    // La ejecución 7 observó UNAVAILABLE: es el camino previsto (el despachador lo reintenta); se comprueba que el reintento converge sin duplicar nada.
    const losers = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code);
    expect(losers).toHaveLength(1); expect(["CONFLICT", "UNAVAILABLE"]).toContain(losers[0]);
    expect((await adaptationFor(Date.now).process(aScope(), command)).replayed).toBe(true);   // el reintento recupera el resultado ya guardado
    expect(await jobsOf(id)).toHaveLength(1); expect((await jobsOf(id))[0]).toMatchObject({ status: "DONE" });
    expect(await count("ps_api09_adapt_links", "order_id = UNHEX(?)", [uuidHex(id)])).toBe(1);
  });
  it("B11.4 recuperación: un intento caído deja el trabajo PROCESSING; con la lease vencida otro lo recupera (LEASE_RECLAIMED, intento 2) y el rezagado ya no puede confirmar", async () => {
    const [id] = await seedOrders("P4", 1); const command = await cmdReceive(id); const gate = deferred();
    const hang: CandidateResolutionPort = { resolve: async (c: LogisticsCandidate) => { await gate.promise; return createSyntheticCandidateResolver().resolve(c); } };
    const settled = adaptationFor(Date.now, hang).process(aScope(), command).then(() => "ok", (e: { code?: string }) => e.code);
    for (let i = 0; i < 50 && (await jobsOf(id)).length === 0; i++) await sleep(50);
    expect((await jobsOf(id))[0]).toMatchObject({ status: "PROCESSING", attempt: 1 });
    const recovered = await adaptationFor(() => Date.now() + 60_000).process(aScope(), command);   // el reloj del segundo proceso ya pasó la lease
    expect(recovered.replayed).toBe(false); expect((await jobsOf(id))[0]).toMatchObject({ status: "DONE", attempt: 2 }); expect(await tracesOf(id)).toEqual(["STARTED:1:-", "LEASE_RECLAIMED:2:-", "SUCCEEDED:2:-"]);
    gate.resolve(); expect(await settled).toBe("CONFLICT");   // el rezagado despierta, ve otra versión del trabajo y NO escribe
    expect(await count("ps_api09_adapt_links", "order_id = UNHEX(?)", [uuidHex(id)])).toBe(1); expect((await linkRowOf(id)).v).toBe(1);
  });
  it("B11.5 fallos: un resolutor caído deja el trabajo RETRYABLE con su traza FAILED (transacción aparte, sin vínculo) y el reintento lo completa", async () => {
    const [id] = await seedOrders("P5", 1); const command = await cmdReceive(id);
    const down: CandidateResolutionPort = { resolve: async (): Promise<unknown> => { throw new Error("caído"); } };
    await expect(adaptationFor(Date.now, down).process(aScope(), command)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect((await jobsOf(id))[0]).toMatchObject({ status: "RETRYABLE", attempt: 1 }); expect(await linkRowOf(id)).toBeUndefined();
    expect(await tracesOf(id)).toEqual(["STARTED:1:-", "FAILED:1:DEPENDENCY_FAILURE"]);
    await adaptationFor(Date.now).process(aScope(), command);
    expect((await jobsOf(id))[0]).toMatchObject({ status: "DONE", attempt: 2 }); expect(await tracesOf(id)).toEqual(["STARTED:1:-", "FAILED:1:DEPENDENCY_FAILURE", "STARTED:2:-", "SUCCEEDED:2:-"]); expect((await linkRowOf(id)).s).toBe("LOGISTICS_REVIEW");
  });
  it("B11.6 atomicidad: si la acción falla después de escribir, NADA queda (ni trabajo ni traza); sin fallo, todo queda", async () => {
    const [bad, good] = await seedOrders("P6", 2); const repo = adaptRepo();
    const job = (orderId: string) => ({ key: `lab-${uid()}`, orderId, inputHash: "a".repeat(64), version: 1, attempt: 1, status: "PROCESSING" as const, leaseUntilMs: Date.now() + 1000, result: null });
    const trace = (j: ReturnType<typeof job>) => ({ jobKey: j.key, orderId: j.orderId, attempt: 1, phase: "STARTED" as const, correlationId: randomUUID(), recordedAt: new Date().toISOString(), failure: null, observation: null });
    const jb = job(bad); await expect(repo.runAtomic(aScope(), async (tx) => { await tx.saveJob(jb, null); await tx.appendTrace(trace(jb)); throw new Error("fallo después de escribir"); })).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await count("ps_api09_adapt_jobs", "order_id = UNHEX(?)", [uuidHex(bad)])).toBe(0); expect(await count("ps_api09_adapt_traces", "order_id = UNHEX(?)", [uuidHex(bad)])).toBe(0);
    const jg = job(good); await repo.runAtomic(aScope(), async (tx) => { await tx.saveJob(jg, null); await tx.appendTrace(trace(jg)); });
    expect(await count("ps_api09_adapt_jobs", "order_id = UNHEX(?)", [uuidHex(good)])).toBe(1); expect(await count("ps_api09_adapt_traces", "order_id = UNHEX(?)", [uuidHex(good)])).toBe(1);
    await expect(repo.runAtomic(aScope(), (tx) => tx.saveJob(jg, null))).rejects.toMatchObject({ code: "CONFLICT" });   // misma clave: el motor impide un segundo trabajo
    await expect(repo.runAtomic(aScope(), (tx) => tx.saveJob({ ...jg, version: 5, attempt: 2 }, 4))).rejects.toMatchObject({ code: "CONFLICT" });   // versión obsoleta: CAS
  });
  it("B11.7 privilegios efectivos del WORKER sobre la adaptación: sin DELETE, sin tocar claves/hash, bitácora solo INSERT, y sin payload cifrado ni recibos", async () => {
    const c = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: manifest.workerUser, password: process.env.PS06A_WORKER_PASSWORD, database: manifest.schema });
    try {
      const denied = async (sql: string, errno: number[]) => { await expect(c.query(sql)).rejects.toSatisfy((e: { errno?: number }) => errno.includes(e.errno ?? 0)); };
      await c.query(`SELECT status, version FROM ${T}.ps_api09_adapt_jobs LIMIT 1`); await c.query(`SELECT version FROM ${T}.ps_api09_adapt_links LIMIT 1`);
      await c.query(`UPDATE ${T}.ps_api09_adapt_jobs SET status = status WHERE 1=0`); await c.query(`UPDATE ${T}.ps_api09_adapt_links SET link_json = link_json WHERE 1=0`);
      await c.query(`SELECT external_order_id, payload_version, state, version, correlation_id, cancellation_reason, received_at FROM ${T}.ps_api01_orders LIMIT 1`);   // exactamente las columnas de la lectura
      for (const table of ["jobs", "links", "traces"]) await denied(`DELETE FROM ${T}.ps_api09_adapt_${table} WHERE 1=0`, [1142]);
      await denied(`UPDATE ${T}.ps_api09_adapt_jobs SET job_key = job_key WHERE 1=0`, [1143, 1142]); await denied(`UPDATE ${T}.ps_api09_adapt_jobs SET input_hash = input_hash WHERE 1=0`, [1143, 1142]);
      await denied(`UPDATE ${T}.ps_api09_adapt_jobs SET order_id = order_id WHERE 1=0`, [1143, 1142]); await denied(`UPDATE ${T}.ps_api09_adapt_links SET order_id = order_id WHERE 1=0`, [1143, 1142]);
      await denied(`UPDATE ${T}.ps_api09_adapt_traces SET phase = phase WHERE 1=0`, [1142, 1143]); await denied(`SELECT * FROM ${T}.ps_api09_adapt_traces`, [1142, 1143]);
      for (const col of ["payload_ciphertext", "payload_key_reference", "input_hash", "receipt_json", "cancellation_hash", "cancellation_receipt_json", "tms_linked"]) await denied(`SELECT ${col} FROM ${T}.ps_api01_orders LIMIT 1`, [1143, 1142]);
      await denied(`INSERT INTO ${T}.ps_api01_orders (id) VALUES (UNHEX('00'))`, [1142, 1143]); await denied(`UPDATE ${T}.ps_api01_orders SET state = state WHERE 1=0`, [1143, 1142]);
      await denied(`CREATE TABLE ${T}.intruso9 (id INT)`, [1142]); await denied(`DROP TABLE ${T}.ps_api09_adapt_jobs`, [1142]);
      const [rows] = await c.query("SHOW GRANTS FOR CURRENT_USER()"); const lines = (rows as Record<string, string>[]).map((r) => Object.values(r)[0]);
      const text = lines.join("\n"); expect(text).not.toMatch(/ALL PRIVILEGES|GRANT OPTION|DELETE|DROP|CREATE|ALTER|SUPER|FILE|PROCESS/);
      for (const line of lines.filter((l) => /INSERT/.test(l))) expect(line).toMatch(/ps_api09_adapt_(jobs|links|traces)/);   // INSERT solo en el diario de adaptación
      for (const line of lines) if (!/^GRANT USAGE ON \*\.\*/.test(line)) expect(line).toContain(manifest.schema);
    } finally { await c.end(); }
  });
  it("B11.8 multiempresa: la lectura, el diario y las claves foráneas respetan el alcance completo, incluso con el mismo identificador externo", async () => {
    const ext = `P8${uid()}`; await appFor(principal(1, 1, "qa-integration", "QA-CLUB")).receive(bytes(body(ext))); await appFor(principal(2, 1, "qa-integration", "QA-CLUB")).receive(bytes(body(ext)));
    const a = await orderIdOf(ext, 1, 1); const b = await orderIdOf(ext, 2, 1); const source = adaptSource();
    expect(await source.load(aScope(1), a)).toMatchObject({ orderId: a, scope: aScope(1), state: "RECEIVED", version: 1, assurance: "SIMULATED", input: { externalOrderId: ext, originClubReference: "QA-CLUB" } });
    expect(await source.load(aScope(1), b)).toBeNull();   // la orden de OTRA empresa es invisible
    expect(await source.load(aScope(1, "OTRO-CLUB"), a)).toBeNull();   // y la de otro club también
    expect(await source.load(aScope(2), b)).toMatchObject({ orderId: b, scope: aScope(2) });
    const ad1 = adaptationFor(Date.now); const ad2 = adaptationFor(Date.now);
    await ad1.process(aScope(1), await cmdReceive(a)); await ad2.process(aScope(2), await cmdReceive(b));
    expect(String((await linkRowOf(a)).r)).toBe(`synthetic:${a}`); expect(String((await linkRowOf(b)).r)).toBe(`synthetic:${b}`);
    await expect(ad1.process(aScope(1), await cmdReceive(b))).rejects.toMatchObject({ code: "NOT_FOUND" });   // el alcance 1 no puede adaptar la orden del 2
    const repo = adaptRepo();
    expect((await repo.runAtomic(aScope(1), (tx) => tx.link(b))).value).toBeNull();   // ni leer su vínculo
    const foreignJob = { key: `lab-${uid()}`, orderId: b, inputHash: "b".repeat(64), version: 1, attempt: 1, status: "PROCESSING" as const, leaseUntilMs: Date.now() + 1000, result: null };
    await expect(repo.runAtomic(aScope(1), (tx) => tx.saveJob(foreignJob, null))).rejects.toMatchObject({ code: "UNAVAILABLE" });   // la clave foránea compuesta impide colgar un trabajo del alcance 1 a la orden del 2
    expect(await count("ps_api09_adapt_jobs", "order_id = UNHEX(?)", [uuidHex(b)])).toBe(1);
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

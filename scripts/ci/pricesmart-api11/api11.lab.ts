// PRICESMART-API-11 — pruebas de los ENDPOINTS y de los puertos de seguridad M2M CONTRA MariaDB real efímera. SOLO se cargan desde el ejecutor (vitest.lab.config.mts).
// Datos exclusivamente sintéticos. El verificador criptográfico de este archivo es SOLO de laboratorio (HMAC con AUTH_SECRET del run): el mecanismo real de autenticación (D02) sigue PENDIENTE
// y NO se ratifica aquí. Lo que se valida es la cadena completa ruta → transporte → seguridad (catálogo, revocación, cuota, anti-repetición) → aplicación → MariaDB.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { sandboxPool } from "../../../src/lib/sandbox-db";
import { mariaDbOrderRepository } from "../../../src/lib/integrations/pricesmart/mariadb-repository";
import { createIsolatedHttpTransport } from "../../../src/lib/integrations/pricesmart/http-transport";
import { requestBindingDigest } from "../../../src/lib/integrations/pricesmart/m2m-security";
import { mariaDbSecurityPorts } from "../../../src/lib/integrations/pricesmart/security-mariadb";
import { runPortConformance } from "../../../src/lib/integrations/pricesmart/port-conformance";
import { handlePriceSmart, installPriceSmartHandler } from "../../../src/lib/integrations/pricesmart/runtime";
import type { Operation } from "../../../src/lib/integrations/pricesmart/security-contracts";
import * as ordersRoute from "../../../src/app/api/integrations/pricesmart/v1/orders/route";
import * as orderRoute from "../../../src/app/api/integrations/pricesmart/v1/orders/[externalOrderId]/route";
import * as cancelRoute from "../../../src/app/api/integrations/pricesmart/v1/orders/[externalOrderId]/cancellation-requests/route";
import { adminOptions, assertAdminOptions } from "../pricesmart-api06a/safety.mjs";
import { makeLabCipher } from "../pricesmart-api06a/lab-cipher";
import { credOf, issuerOf, subjectOf } from "./ddl.mjs";

const manifestPath = process.env.PS06A_MANIFEST;
if (!manifestPath || process.env.PS06A_PHASE !== "api11" || process.env.NOVALVION_ENV !== "sandbox") throw new Error("API-11: esta suite solo se ejecuta desde el ejecutor del laboratorio.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { schema: string; user: string; port: number; pipe: string };
const T = `\`${manifest.schema}\``;
const LAB_SECRET = String(process.env.AUTH_SECRET);

// ---- composición de laboratorio (la misma que usaría una composición administrativa, con el verificador SOLO de laboratorio)
const raw = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectionLimit: 10 });
const pool = sandboxPool(raw);
afterAll(async () => { installPriceSmartHandler(null); await pool.end(); });
const repository = mariaDbOrderRepository(pool, { schema: manifest.schema, runtimeUser: manifest.user, cipher: makeLabCipher(process.env.AUTH_SECRET) });
const ports = mariaDbSecurityPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user });
const KEYS = { a: { tenantId: 1, clientId: 1, integrationId: "qa-integration" }, b: { tenantId: 2, clientId: 1, integrationId: "qa-integration" }, ro: { tenantId: 1, clientId: 2, integrationId: "qa-integration" },
  rev: { tenantId: 1, clientId: 1, integrationId: "qa-other" }, exp: { tenantId: 1, clientId: 1, integrationId: "qa-other" } } as const;
type Key = keyof typeof KEYS | "ghost";
const mac = (payload: string) => createHmac("sha256", LAB_SECRET).update(`api11-lab:${payload}`).digest();
const EVIDENCE_HEADER = "x-lab-evidence";   // SOLO laboratorio
const evidencePort = { async extract({ headers }: { headers: readonly (readonly [string, string])[] }) {
  const v = headers.find(([n]) => n === EVIDENCE_HEADER)?.[1]; return v === undefined ? null : new TextEncoder().encode(v);
} };
const verifier = { async verify(evidence: Uint8Array) {
  const [payload, sig] = new TextDecoder().decode(evidence).split("."); if (!payload || !sig) return null;
  const expected = mac(payload); const got = Buffer.from(sig, "hex"); if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { k: string; proof: unknown }; const now = Date.now();
  return { environment: "sandbox", issuer: issuerOf(), subject: subjectOf(p.k), credentialReference: credOf(p.k), validFromMs: now - 60000, validUntilMs: now + 600000, scopes: ["orders:create", "orders:read", "orders:cancel"], requestProof: p.proof };
} };
const policy = (requestsPerWindow = 100000, windowMs = 60000) => ({ maxEvidenceBytes: 4096, maxBodyBytes: 4096, requestsPerWindow, windowMs, maxProofAgeMs: 300000, futureSkewMs: 5000, replayRetentionMs: 400000 });
const limits = { originClubReference: "QA-CLUB", timeoutMs: 15000, maxHeaderBytes: 8192, maxHeaderCount: 32, maxUrlBytes: 2048, maxBodyChunks: 64 };
const transport = (pol = policy()) => createIsolatedHttpTransport({ evidence: evidencePort, security: { verifier, catalog: ports.catalog, revocation: ports.revocation, clock: ports.clock, counter: ports.counter, replay: ports.replay }, repository }, pol, limits);

// ---- cliente de prueba
const BASE = "/api/integrations/pricesmart/v1/orders";
const enc = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const uid = () => `L${randomBytes(6).toString("hex")}`;
type Sent = { status: number; json: Record<string, unknown>; headers: Headers };
function signed(key: Key, operation: Operation, externalId: string | undefined, body: Uint8Array, over: { proofId?: string; bodyForDigest?: Uint8Array; issuedAtMs?: number; tamper?: boolean } = {}) {
  const k = key === "ghost" ? "a" : key; const now = Date.now();
  const target = { environment: "sandbox" as const, ...KEYS[k], originClubReference: "QA-CLUB", ...(externalId ? { externalOrderId: externalId } : {}) };
  const proof = { id: over.proofId ?? `p${randomBytes(8).toString("hex")}`, issuedAtMs: over.issuedAtMs ?? now, expiresAtMs: (over.issuedAtMs ?? now) + 60000, bindingDigest: requestBindingDigest(operation, target, over.bodyForDigest ?? body) };
  const payload = Buffer.from(JSON.stringify({ k: key === "ghost" ? "ghost" : k, proof })).toString("base64url");
  const sig = over.tamper ? "00".repeat(32) : mac(payload).toString("hex");
  return `${payload}.${sig}`;
}
async function send(handler: (r: Request) => Promise<Response>, method: "GET" | "POST", path: string, op: Operation, key: Key | null, externalId: string | undefined, body?: unknown, over: Parameters<typeof signed>[4] = {}): Promise<Sent> {
  const bytes = body === undefined ? new Uint8Array(0) : enc(body);
  const headers = new Headers({ accept: "application/json" }); if (method === "POST") headers.set("content-type", "application/json");
  if (key !== null) headers.set(EVIDENCE_HEADER, signed(key, op, externalId, bytes, over));
  const res = await handler(new Request(`http://localhost${path}`, { method, headers, body: method === "POST" ? bytes : undefined }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown>, headers: res.headers };
}
const order = (id: string) => ({ schemaVersion: "api01-draft-1", externalOrderId: id, originClubReference: "QA-CLUB" });
const create = (h: (r: Request) => Promise<Response>, key: Key | null, id: string, over?: Parameters<typeof signed>[4]) => send(h, "POST", BASE, "orders:create", key, id, order(id), over);
const read = (h: (r: Request) => Promise<Response>, key: Key | null, id: string) => send(h, "GET", `${BASE}/${id}`, "orders:read", key, id);
const cancel = (h: (r: Request) => Promise<Response>, key: Key | null, id: string, reason = "ORIGIN_REQUEST") => send(h, "POST", `${BASE}/${id}/cancellation-requests`, "orders:cancel", key, id, { reason });

// ---- lectura administrativa (solo SELECT por el pipe del run)
async function admin(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  if (!/^SELECT\s/i.test(sql) || sql.includes(";")) throw new Error("admin(): solo SELECT");
  const o = adminOptions(manifest); assertAdminOptions(o, manifest); const c = await mysql.createConnection(o);
  try { const [rows] = await c.query(sql, params); return rows as Record<string, unknown>[]; } finally { await c.end(); }
}
const n = async (table: string, where: string, params: unknown[] = []) => Number((await admin(`SELECT COUNT(*) AS n FROM ${T}.${table} WHERE ${where}`, params))[0].n);
const orderRows = (id: string, tenant?: number) => n("ps_api01_orders", `external_order_id = ?${tenant ? " AND tenant_id = ?" : ""}`, tenant ? [Buffer.from(id), tenant] : [Buffer.from(id)]);
const errno = async (p: Promise<unknown>) => { try { await p; return 0; } catch (e) { return (e as { errno?: number }).errno ?? -1; } };
/** Evita que la ventana fija de la cuota cambie a mitad de una prueba. */
async function windowSafe(windowMs: number, marginMs = 20000) { const left = windowMs - (Date.now() % windowMs); if (left < marginMs) await new Promise((r) => setTimeout(r, left + 200)); }

describe("API-11 endpoints y seguridad M2M", () => {
  it("API11.1 cerrado por defecto: sin composición instalada, las tres rutas responden 503 DISABLED sin consultar nada", async () => {
    installPriceSmartHandler(null);
    const before = await n("ps_api01_orders", "1=1");
    for (const [fn, url, method] of [[ordersRoute.POST, BASE, "POST"], [orderRoute.GET, `${BASE}/X1`, "GET"], [cancelRoute.POST, `${BASE}/X1/cancellation-requests`, "POST"]] as const) {
      const res = await fn(new Request(`http://localhost${url}`, { method, headers: { "x-lab-evidence": "x" }, body: method === "POST" ? "{}" : undefined }));
      const j = (await res.json()) as Record<string, unknown>; expect(res.status).toBe(503); expect(j.code).toBe("DISABLED"); expect(Object.keys(j).sort()).toEqual(["code", "correlationId"]);
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
    expect(await n("ps_api01_orders", "1=1")).toBe(before);
    installPriceSmartHandler(transport());   // a partir de aquí, las pruebas usan las rutas reales
  });

  it("API11.2 POST /orders crea la orden: 202 RECEIVED/PENDING v1 y deja orden cifrada, evento, outbox PENDING y auditoría, SIN vincular al TMS", async () => {
    const id = uid(); const r = await create(handlePriceSmart, "a", id);
    expect(r.status).toBe(202); expect(r.json).toMatchObject({ externalOrderId: id, provisionalStatus: "RECEIVED", processingStatus: "PENDING", version: 1 }); expect(r.headers.get("x-correlation-id")).toBeTruthy();
    const [o] = await admin(`SELECT HEX(id) AS id, tms_linked, state, version, OCTET_LENGTH(payload_ciphertext) AS len, payload_ciphertext LIKE ? AS plain FROM ${T}.ps_api01_orders WHERE external_order_id = ? AND tenant_id = 1`, [`%${id}%`, Buffer.from(id)]);
    expect(Number(o.tms_linked)).toBe(0); expect(o.state).toBe("RECEIVED"); expect(Number(o.version)).toBe(1); expect(Number(o.len)).toBeGreaterThan(28); expect(Number(o.plain)).toBe(0);
    expect(await n("ps_api01_events", "order_id = UNHEX(?)", [o.id])).toBe(1);
    expect(await n("ps_api01_outbox", "order_id = UNHEX(?) AND status = 'PENDING'", [o.id])).toBe(1);
    expect(await n("ps_api01_audit", "order_id = UNHEX(?) AND operation = 'RECEIVE'", [o.id])).toBe(1);
  });

  it("API11.3 reenvío idempotente: la misma orden con una prueba nueva devuelve el MISMO recibo y no duplica filas", async () => {
    const id = uid(); const first = await create(handlePriceSmart, "a", id); const again = await create(handlePriceSmart, "a", id);
    expect(first.status).toBe(202); expect(again.status).toBe(202); expect(again.json).toEqual(first.json);
    expect(await orderRows(id)).toBe(1); expect(await n("ps_api01_events", "order_id = (SELECT id FROM " + T + ".ps_api01_orders WHERE external_order_id = ? AND tenant_id = 1)", [Buffer.from(id)])).toBe(1);
    expect(await n("ps_api01_audit", "operation = 'REPLAY' AND order_id = (SELECT id FROM " + T + ".ps_api01_orders WHERE external_order_id = ? AND tenant_id = 1)", [Buffer.from(id)])).toBe(1);
  });

  it("API11.4 anti-repetición e integridad de la solicitud: misma prueba → 409; prueba de otro cuerpo, vencida o con firma alterada → rechazada sin crear nada", async () => {
    const id = uid(); const proofId = `fixed${randomBytes(6).toString("hex")}`;
    expect((await create(handlePriceSmart, "a", id, { proofId })).status).toBe(202);
    const replay = await create(handlePriceSmart, "a", id, { proofId }); expect(replay.status).toBe(409); expect(replay.json.code).toBe("REPLAY_REJECTED");
    const other = uid(); const wrongBody = await create(handlePriceSmart, "a", other, { bodyForDigest: enc(order(uid())) }); expect([401, 403]).toContain(wrongBody.status);
    const stale = await create(handlePriceSmart, "a", other, { issuedAtMs: Date.now() - 3600000 }); expect([401, 403]).toContain(stale.status);
    const tampered = await create(handlePriceSmart, "a", other, { tamper: true }); expect(tampered.status).toBe(401);
    expect(await orderRows(other)).toBe(0);
  });

  it("API11.5 GET /orders/{id}: devuelve el estado; id inexistente → 404; el detalle no filtra datos internos", async () => {
    const id = uid(); await create(handlePriceSmart, "a", id);
    const r = await read(handlePriceSmart, "a", id); expect(r.status).toBe(200); expect(Object.keys(r.json).sort()).toEqual(["correlationId", "externalOrderId", "processingStatus", "provisionalStatus", "version"]);
    expect(r.json).toMatchObject({ externalOrderId: id, provisionalStatus: "RECEIVED", processingStatus: "PENDING", version: 1 });
    expect((await read(handlePriceSmart, "a", uid())).status).toBe(404);
    expect((await read(handlePriceSmart, null, "bad%20id")).status).toBe(400);
  });

  it("API11.6 cancelación: 202 CANCELLATION_REQUESTED v2, idempotente con la misma razón, 409 con otra, visible por GET; inexistente → 404", async () => {
    const id = uid(); await create(handlePriceSmart, "a", id);
    const c1 = await cancel(handlePriceSmart, "a", id); expect(c1.status).toBe(202); expect(c1.json).toMatchObject({ provisionalStatus: "CANCELLATION_REQUESTED", processingStatus: "PAUSED", version: 2 });
    const c2 = await cancel(handlePriceSmart, "a", id); expect(c2.status).toBe(202); expect(c2.json).toEqual(c1.json);
    const c3 = await cancel(handlePriceSmart, "a", id, "DUPLICATE"); expect(c3.status).toBe(409); expect(c3.json.code).toBe("CONFLICT");
    expect((await read(handlePriceSmart, "a", id)).json).toMatchObject({ provisionalStatus: "CANCELLATION_REQUESTED", version: 2 });
    expect((await cancel(handlePriceSmart, "a", uid())).status).toBe(404);
    expect(await n("ps_api01_outbox", "order_version = 2 AND order_id = (SELECT id FROM " + T + ".ps_api01_orders WHERE external_order_id = ? AND tenant_id = 1)", [Buffer.from(id)])).toBe(1);
  });

  it("API11.7 autenticación: sin evidencia, firma inválida, credencial desconocida, revocada o vencida → 401 con cuerpo mínimo; no se crea nada", async () => {
    const id = uid();
    const none = await create(handlePriceSmart, null, id); expect(none.status).toBe(401);
    expect((await create(handlePriceSmart, "a", id, { tamper: true })).status).toBe(401);
    expect((await create(handlePriceSmart, "ghost", id)).status).toBe(401);
    const revoked = await create(handlePriceSmart, "rev", id); expect(revoked.status).toBe(401);
    const expired = await create(handlePriceSmart, "exp", id); expect(expired.status).toBe(401);
    for (const r of [none, revoked, expired]) expect(Object.keys(r.json).sort()).toEqual(["code", "correlationId"]);
    expect(await orderRows(id)).toBe(0);
  });

  it("API11.8 autorización: una integración de solo lectura no crea ni cancela (403) pero sí consulta; el mismo identificador en otra empresa es otra orden", async () => {
    const id = uid(); await create(handlePriceSmart, "a", id);
    expect((await create(handlePriceSmart, "ro", uid())).status).toBe(403);
    expect((await cancel(handlePriceSmart, "ro", id)).status).toBe(403);
    expect((await read(handlePriceSmart, "ro", id)).status).toBe(404);   // otro cliente (alcance distinto): no ve la orden
    expect((await create(handlePriceSmart, "b", id)).status).toBe(202);   // mismo externalOrderId en otra empresa: orden independiente
    expect(await orderRows(id)).toBe(2); expect(await orderRows(id, 2)).toBe(1);
  });

  it("API11.9 aislamiento multiempresa: otra empresa no puede ver ni cancelar la orden ajena (404) y la orden propia queda intacta", async () => {
    const id = uid(); await create(handlePriceSmart, "a", id);
    expect((await read(handlePriceSmart, "b", id)).status).toBe(404);
    expect((await cancel(handlePriceSmart, "b", id)).status).toBe(404);
    expect((await read(handlePriceSmart, "a", id)).json).toMatchObject({ provisionalStatus: "RECEIVED", version: 1 });
  });

  it("API11.10 concurrencia: 8 POST simultáneos de la misma orden → todos 202 con el mismo recibo y UNA sola fila, evento y outbox", async () => {
    const id = uid(); const all = await Promise.all(Array.from({ length: 8 }, () => create(handlePriceSmart, "a", id)));
    expect(all.map((r) => r.status)).toEqual(Array(8).fill(202)); expect(new Set(all.map((r) => JSON.stringify(r.json))).size).toBe(1);
    expect(await orderRows(id)).toBe(1);
    const [o] = await admin(`SELECT HEX(id) AS id FROM ${T}.ps_api01_orders WHERE external_order_id = ? AND tenant_id = 1`, [Buffer.from(id)]);
    expect(await n("ps_api01_events", "order_id = UNHEX(?)", [o.id])).toBe(1); expect(await n("ps_api01_outbox", "order_id = UNHEX(?)", [o.id])).toBe(1);
  });

  it("API11.11 cuota y reclamos atómicos: el contador nunca excede el límite con 12 conexiones, el límite HTTP responde 429 y un nonce concurrente se reclama una sola vez", async () => {
    // contador: 12 consumos simultáneos con límite 5 → exactamente 5 permitidos, y cada uno recibe un valor distinto (1…12)
    const key = `lab-counter-${uid()}`; await windowSafe(60000);
    const res = await Promise.all(Array.from({ length: 12 }, () => ports.counter.consume({ identityKey: key, limit: 5, windowMs: 60000, nowMs: Date.now() })));
    expect(res.filter((r) => r.allowed)).toHaveLength(5); expect(res.map((r) => r.used).sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(res.every((r) => r.assurance === "DISTRIBUTED_ATOMIC")).toBe(true);
    // HTTP: límite 3 por ventana larga → la 4.ª solicitud autenticada recibe 429
    const windowMs = 3600000; await windowSafe(windowMs, 30000); const limited = transport(policy(3, windowMs));
    const codes: number[] = []; for (let i = 0; i < 4; i++) codes.push((await read(limited, "ro", uid())).status);
    expect(codes).toEqual([404, 404, 404, 429]);
    // reclamo: 10 simultáneos del mismo nonce+digest → 1 CLAIMED y 9 REUSED; otro digest → COLLISION
    const digest = createHash("sha256").update(uid()).digest("hex"); const other = createHash("sha256").update(uid()).digest("hex"); const proofId = uid(); const now = Date.now();
    const claim = (d: string) => ports.replay.claim({ identityKey: "lab-identity", proofId, bindingDigest: d, retainUntilMs: now + 60000, nowMs: now });
    const claims = await Promise.all(Array.from({ length: 10 }, () => claim(digest)));
    expect(claims.filter((c) => c.status === "CLAIMED")).toHaveLength(1); expect(claims.filter((c) => c.status === "REUSED")).toHaveLength(9);
    expect((await claim(other)).status).toBe("COLLISION");
  });

  it("API11.12 privilegios mínimos: la cuenta de ejecución no puede alterar el catálogo ni las revocaciones, ni borrar contadores/reclamos, ni reescribir una prueba; los errores de datos no filtran SQL", async () => {
    const run = (sql: string, p: unknown[] = []) => errno(pool.execute(sql, p as never));
    expect(await run(`UPDATE ${T}.ps_api11_integrations SET status = 'REVOKED' WHERE 1 = 0`)).toBe(1142);
    expect(await run(`DELETE FROM ${T}.ps_api11_integrations WHERE 1 = 0`)).toBe(1142);
    expect(await run(`INSERT INTO ${T}.ps_api11_revocations (issuer, subject, credential_reference, revision, revoked_at_ms) VALUES (_binary'x', _binary'x', _binary'x', 1, 1)`)).toBe(1142);
    expect(await run(`DELETE FROM ${T}.ps_api11_rate_counters WHERE 1 = 0`)).toBe(1142);
    expect(await run(`UPDATE ${T}.ps_api11_rate_counters SET window_start_ms = 0 WHERE 1 = 0`)).toBe(1143);   // solo la columna `used` es actualizable
    expect(await run(`DELETE FROM ${T}.ps_api11_proof_claims WHERE 1 = 0`)).toBe(1142);
    expect(await run(`UPDATE ${T}.ps_api11_proof_claims SET binding_digest = binding_digest WHERE 1 = 0`)).toBe(1142);
    expect(await errno(pool.query(`TRUNCATE TABLE ${T}.ps_api11_proof_claims`))).toBe(1142);
    // una entrada malformada produce un error cerrado y sin detalles
    const bad = await send(handlePriceSmart, "POST", BASE, "orders:create", "a", "x", { schemaVersion: "api01-draft-1", externalOrderId: "x", originClubReference: "QA-CLUB", extra: "SELECT 1" });
    expect(bad.status).toBe(400); expect(Object.keys(bad.json).sort()).toEqual(["code", "correlationId"]);
    expect(JSON.stringify(bad.json)).not.toMatch(/SELECT|sandbox_api02|stack/i);
  });

  it("API11.13 conformidad de puertos (API-16): los puertos MariaDB reales de contador, replay, catálogo y reloj, el cifrado de laboratorio y el verificador de laboratorio superan la suite de conformidad; el informe no contiene valores", async () => {
    const report = await runPortConformance({ counter: ports.counter, replay: ports.replay, catalog: ports.catalog, clock: ports.clock, cipher: makeLabCipher(process.env.AUTH_SECRET), verifier });
    expect(report.results.filter((r) => !r.pass)).toEqual([]);
    expect(report.conformant).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/secret|AUTH_SECRET|sandbox_api02/i);
  });
});

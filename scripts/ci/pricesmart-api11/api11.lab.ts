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
import { mariaDbAttestationPorts } from "../../../src/lib/integrations/pricesmart/attestation-mariadb";
import { createRegistryIdentityAuthority } from "../../../src/lib/integrations/pricesmart/registry-identity-authority";
import { issueAttestation } from "../../../src/lib/integrations/pricesmart/conformance-attestation";
import { checkInstallationEligibility, redeemInstallationEligibility } from "../../../src/lib/integrations/pricesmart/installation-gate";
import { describeMariaDbComposition } from "../../../src/lib/integrations/pricesmart/mariadb-composition";
import { createProviderCipher } from "../../../src/lib/integrations/pricesmart/provider-cipher";
import { createLabKeyProvider } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-key-provider";
import { guardEvidenceVerifier } from "../../../src/lib/integrations/pricesmart/guarded-evidence-verifier";
import { reference } from "../../../src/lib/integrations/pricesmart/contracts";
import { auditGrants } from "../../../src/lib/integrations/pricesmart/grants-audit";
import { PREFLIGHT_STATEMENTS, mariaDbPreflightDatabase } from "../../../src/lib/integrations/pricesmart/preflight-mariadb";
import { runProductionPreflight } from "../../../src/lib/integrations/pricesmart/production-preflight";
import { createKmsKeyProvider, parseKmsConfig } from "../../../src/lib/integrations/pricesmart/kms-adapter";
import { createLabKmsClient } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-kms-client";
import { auditRoleGrants, type AccountRole } from "../../../src/lib/integrations/pricesmart/grants-audit";
import { buildAccountGrantPlan } from "../../../src/lib/integrations/pricesmart/account-plans";
import { runCompositionPreflight } from "../../../src/lib/integrations/pricesmart/composition-preflight";
import { REVIEWED_KMS_ADAPTERS, type KmsAdapterRegistry } from "../../../src/lib/integrations/pricesmart/kms-provider-selection";
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

// ---- API-21: tres cuentas REALES de laboratorio (ejecución adicional, escritura del registro y migración) creadas con el plan de privilegios en la MariaDB desechable.
// Las contraseñas se generan al azar en memoria, nunca se imprimen ni se guardan; el plan que se ejecuta es el mismo texto que se entregaría a revisión (solo GRANT).
type LabAccount = { role: AccountRole; user: string; password: string };
let labAccounts: Promise<Record<AccountRole, LabAccount>> | null = null;
function ensureLabAccounts() {
  labAccounts ??= (async () => {
    const tag = randomBytes(3).toString("hex"); const out = {} as Record<AccountRole, LabAccount>;
    const admin = await mysql.createConnection(adminOptions(manifest));
    try {
      for (const [role, suffix] of [["runtime", "run"], ["registryWriter", "reg"], ["migration", "mig"]] as [AccountRole, string][]) {
        const user = `sandbox_api02_p21${suffix}${tag}`; const password = randomBytes(18).toString("base64url");
        await admin.query("CREATE USER ?@'127.0.0.1' IDENTIFIED BY ?", [user, password]);
        for (const grant of buildAccountGrantPlan(role, { schema: manifest.schema, user, host: "127.0.0.1" })) await admin.query(grant);
        out[role] = { role, user, password };
      }
    } finally { await admin.end(); }
    return out;
  })();
  return labAccounts;
}
const accountPool = (a: LabAccount) => mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: a.user, password: a.password, database: manifest.schema, connectionLimit: 2 });

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

  it("API11.14 nonces de atestación durables y atómicos (API-18): 20 canjes simultáneos del mismo nonce → exactamente 1 FRESH; otro almacén (otra instancia) lo ve USED; se guarda solo el hash", async () => {
    const att = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    const nonce = randomBytes(16).toString("hex"); const expires = Date.now() + 600000;
    const results = await Promise.all(Array.from({ length: 20 }, () => att.nonces.consume(nonce, expires)));
    expect(results.filter((r) => r === "FRESH")).toHaveLength(1); expect(results.filter((r) => r === "USED")).toHaveLength(19);
    const second = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    expect(await second.nonces.consume(nonce, expires)).toBe("USED");   // compartido y durable entre instancias
    expect(await second.nonces.consume(randomBytes(16).toString("hex"), expires)).toBe("FRESH");
    const hash = createHash("sha256").update(`pricesmart-api18-nonce-v1:${nonce}`).digest();
    expect(await n("ps_api18_attestation_nonces", "target = 'LAB' AND nonce_hash = ?", [hash])).toBe(1);
    expect(await n("ps_api18_attestation_nonces", "target = 'PRODUCTION'")).toBe(0);
    const stored = await admin(`SELECT HEX(nonce_hash) AS h FROM ${T}.ps_api18_attestation_nonces WHERE target = 'LAB'`);
    expect(JSON.stringify(stored)).not.toContain(nonce);   // el nonce en claro nunca se persiste
  });

  it("API11.15 privilegios y separación (API-18): el runtime solo inserta/lee nonces y solo LEE el registro; el registro del laboratorio contiene únicamente destino LAB; el destino PRODUCTION no se consulta ni se construye con este pool", async () => {
    const run = (sql: string, p: unknown[] = []) => errno(pool.execute(sql, p as never));
    expect(await run(`UPDATE ${T}.ps_api18_attestation_nonces SET expires_at_ms = 1 WHERE 1 = 0`)).toBe(1142);
    expect(await run(`DELETE FROM ${T}.ps_api18_attestation_nonces WHERE 1 = 0`)).toBe(1142);
    expect(await run(`INSERT INTO ${T}.ps_api18_resource_registry (target, port, resource_id, subject, status) VALUES ('LAB', 'clock', _binary'intruso', 'LIVE', 'ACTIVE')`)).toBe(1142);
    expect(await run(`UPDATE ${T}.ps_api18_resource_registry SET subject = 'LIVE' WHERE 1 = 0`)).toBe(1142);
    expect(await run(`DELETE FROM ${T}.ps_api18_resource_registry WHERE 1 = 0`)).toBe(1142);
    expect(await errno(pool.query(`TRUNCATE TABLE ${T}.ps_api18_attestation_nonces`))).toBe(1142);
    expect(await n("ps_api18_resource_registry", "target <> 'LAB'")).toBe(0);
    const att = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    expect(await att.registry.lookup({ target: "LAB", port: "counter", resourceId: "lab-counter-iso" })).toEqual({ subject: "ISOLATED_COPY", status: "ACTIVE" });
    expect(await att.registry.lookup({ target: "LAB", port: "counter", resourceId: "lab-counter-live" })).toEqual({ subject: "LIVE", status: "ACTIVE" });
    expect(await att.registry.lookup({ target: "LAB", port: "counter", resourceId: "no-registrado" })).toBeNull();
    expect(await att.registry.lookup({ target: "PRODUCTION", port: "counter", resourceId: "lab-counter-iso" })).toBeNull();
    expect(() => mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "PRODUCTION" })).toThrow();
  });

  it("API11.16 composición administrativa de laboratorio de extremo a extremo (API-18): puertos MariaDB reales + autoridad respaldada por el registro + nonces durables → atestación → elegibilidad; incompleta, no registrada, de otro destino o repetida se rechazan", async () => {
    const att = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    const KEY = randomBytes(32); const AUTH_KEY = randomBytes(32); const keys = { getKey: async () => AUTH_KEY };
    const cipherInstance = makeLabCipher(process.env.AUTH_SECRET);
    const built = describeMariaDbComposition(ports, { cipher: { instance: cipherInstance, implementationId: "lab-cipher", version: "api12-1" }, verifier: { instance: verifier, implementationId: "lab-verifier", version: "api11-1" } });
    expect(built.missing).toEqual([]);
    const authority = createRegistryIdentityAuthority({ authorityId: "auth-lab-registry", target: "LAB", registry: att.registry, keys });
    const ids: Record<string, string> = { counter: "lab-counter-iso", replay: "lab-replay-iso", catalog: "lab-catalog", clock: "lab-clock", cipher: "lab-cipher", verifier: "lab-verifier" };
    for (const [port, d] of Object.entries(built.composition) as [string, { instance: object }][]) authority.enroll(d.instance, port as never, ids[port]);
    const identity = { authority, trusted: { "auth-lab-registry": AUTH_KEY } };
    const issued = await issueAttestation({ composition: built.composition, target: "LAB", key: KEY, nowMs: Date.now(), ttlMs: 120000, identity });
    expect(issued.claims.conformant && issued.claims.complete).toBe(true);
    expect(issued.claims.ports.find((p) => p.port === "counter")).toMatchObject({ resourceId: "lab-counter-iso", subject: "ISOLATED_COPY", authorityId: "auth-lab-registry" });
    const trust = { lab: { "auth-lab-registry": AUTH_KEY }, production: { "auth-prod-registry": randomBytes(32) } };   // confianza explícita y separada de ambos destinos
    const base = { composition: built.composition, attestation: issued.attestation, target: "LAB" as const, key: KEY, authority, trust, clock: ports.clock };
    expect(await checkInstallationEligibility(base)).toEqual({ eligible: true, target: "LAB", consumedNonce: false });
    expect(await redeemInstallationEligibility({ ...base, nonces: att.nonces })).toEqual({ eligible: true, target: "LAB", consumedNonce: true });
    const other = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    expect(await redeemInstallationEligibility({ ...base, nonces: other.nonces })).toEqual({ eligible: false, reason: "REPLAYED" });   // el canje sobrevive a otra instancia del almacén
    // composición incompleta (sin cifrado ni verificador, como hoy en producción)
    const partial = describeMariaDbComposition(ports); expect(partial.missing).toEqual(["cipher", "verifier"]);
    expect(await checkInstallationEligibility({ ...base, composition: partial.composition })).toMatchObject({ eligible: false, reason: "INCOMPLETE_COMPOSITION" });
    // recurso no registrado: no se atesta
    const rogue = createRegistryIdentityAuthority({ authorityId: "auth-lab-registry", target: "LAB", registry: att.registry, keys });
    for (const [port, d] of Object.entries(built.composition) as [string, { instance: object }][]) rogue.enroll(d.instance, port as never, port === "catalog" ? "no-registrado" : ids[port]);
    await expect(issueAttestation({ composition: built.composition, target: "LAB", key: KEY, nowMs: Date.now(), ttlMs: 120000, identity: { authority: rogue, trusted: identity.trusted } })).rejects.toThrow();
    // la autoridad de laboratorio no habla por producción y la atestación de laboratorio no sirve como de producción
    await expect(issueAttestation({ composition: built.composition, target: "PRODUCTION", key: KEY, nowMs: Date.now(), ttlMs: 120000, identity })).rejects.toThrow();
    expect(await checkInstallationEligibility({ ...base, target: "PRODUCTION" })).toMatchObject({ eligible: false });
    // omitir o solapar la confianza nunca da una decisión favorable
    for (const bad of [undefined, {}, { lab: trust.lab }, { lab: {}, production: trust.production }, { lab: trust.lab, production: { "auth-lab-registry": randomBytes(32) } }, { lab: trust.lab, production: { "auth-prod-registry": AUTH_KEY } }])
      expect(await checkInstallationEligibility({ ...base, trust: bad as never })).toEqual({ eligible: false, reason: "TRUST_CONFIG_INVALID" });
    // los recursos de producción no se tocaron
    expect(await n("ps_api18_attestation_nonces", "target = 'PRODUCTION'")).toBe(0);
    expect(JSON.stringify(issued)).not.toContain(KEY.toString("hex")); expect(JSON.stringify(issued)).not.toContain(AUTH_KEY.toString("hex"));
  });

  it("API11.17 cifrado con proveedor externo y verificador protegido (API-19): el adaptador de cifrado y el verificador de laboratorio envuelto, junto con los puertos MariaDB reales, superan la conformidad, se atestan con la autoridad por registro y pasan la compuerta; las claves nunca se persisten", async () => {
    const att = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    const KEY = randomBytes(32); const AUTH_KEY = randomBytes(32);
    const provider = createLabKeyProvider(); const providerCipher = createProviderCipher({ provider, target: "LAB" });
    const guarded = guardEvidenceVerifier(verifier);
    // el verificador de laboratorio sigue autenticando a través de la envoltura (aserciones válidas) y la envoltura deniega basura
    expect(await guarded.verify(randomBytes(64), { environment: "sandbox" })).toBeNull();
    const sealed = await providerCipher.seal({ externalOrderId: "API19-X", note: "valor" } as never, "api19-ctx");
    expect(reference.safeParse(sealed.keyReference).success).toBe(true);   // la referencia de clave cumple el esquema que usa el repositorio
    expect(await providerCipher.open(sealed.ciphertext, sealed.keyReference, "api19-ctx")).toEqual({ externalOrderId: "API19-X", note: "valor" });
    const built = describeMariaDbComposition(ports, { cipher: { instance: providerCipher, implementationId: "provider-cipher", version: "api19-1" }, verifier: { instance: guarded, implementationId: "guarded-verifier", version: "api19-1" } });
    expect(built.missing).toEqual([]);
    const authority = createRegistryIdentityAuthority({ authorityId: "auth-lab-registry", target: "LAB", registry: att.registry, keys: { getKey: async () => AUTH_KEY } });
    const ids: Record<string, string> = { counter: "lab-counter-iso", replay: "lab-replay-iso", catalog: "lab-catalog", clock: "lab-clock", cipher: "lab-cipher", verifier: "lab-verifier" };
    for (const [port, d] of Object.entries(built.composition) as [string, { instance: object }][]) authority.enroll(d.instance, port as never, ids[port]);
    const identity = { authority, trusted: { "auth-lab-registry": AUTH_KEY } };
    const issued = await issueAttestation({ composition: built.composition, target: "LAB", key: KEY, nowMs: Date.now(), ttlMs: 120000, identity });
    expect(issued.claims.results.filter((r) => !r.pass)).toEqual([]); expect(issued.claims.conformant && issued.claims.complete).toBe(true);
    const trust = { lab: { "auth-lab-registry": AUTH_KEY }, production: { "auth-prod-registry": randomBytes(32) } };
    const base = { composition: built.composition, attestation: issued.attestation, target: "LAB" as const, key: KEY, authority, trust, clock: ports.clock };
    expect(await redeemInstallationEligibility({ ...base, nonces: att.nonces })).toEqual({ eligible: true, target: "LAB", consumedNonce: true });
    // sustituir el proveedor de claves (otras claves, mismo código) invalida la atestación aunque el código del adaptador no cambie
    const otherCipher = createProviderCipher({ provider: createLabKeyProvider(), target: "LAB" });   // mismo código, otro proveedor/claves, NO inscrito en la autoridad
    expect(await checkInstallationEligibility({ ...base, composition: { ...built.composition, cipher: { instance: otherCipher, implementationId: "provider-cipher", version: "api19-1" } } })).toEqual({ eligible: false, reason: "IDENTITY_MISMATCH" });
    // nada de claves ni de la atestación se persistió fuera de los hashes de nonce
    const stored = JSON.stringify(await admin(`SELECT HEX(nonce_hash) AS h FROM ${T}.ps_api18_attestation_nonces`));
    expect(stored).not.toContain(KEY.toString("hex")); expect(stored).not.toContain(AUTH_KEY.toString("hex")); expect(JSON.stringify(issued)).not.toContain(AUTH_KEY.toString("hex"));
  });

  it("API11.18 auditoría de privilegios (API-20): la cuenta de ejecución REAL cumple la política mínima (solo lecturas fijas, sin hallazgos); una cuenta con privilegios globales (la administrativa del arnés) se rechaza; los hallazgos no incluyen texto de las líneas", async () => {
    const db = mariaDbPreflightDatabase(pool);
    const identity = await db.identity(); expect(identity.db).toBe(manifest.schema); expect(identity.account.startsWith(`${manifest.user}@`)).toBe(true);
    const audit = auditGrants(await db.grants(), { schema: manifest.schema });
    expect(audit.findings).toEqual([]); expect(audit).toMatchObject({ ok: true, complete: true, missing: [] });
    const adminConn = await mysql.createConnection(adminOptions(manifest)); let adminLines: string[] = [];
    try { const [rows] = await adminConn.query("SHOW GRANTS FOR CURRENT_USER()"); adminLines = (rows as Record<string, unknown>[]).map((r) => String(Object.values(r)[0])); } finally { await adminConn.end(); }
    const bad = auditGrants(adminLines, { schema: manifest.schema });
    expect(bad.ok).toBe(false); expect(bad.findings.map((f) => f.code)).toEqual(expect.arrayContaining(["GLOBAL_PRIVILEGE"]));
    expect(JSON.stringify(bad)).not.toMatch(/IDENTIFIED|PASSWORD|127\.0\.0\.1|GRANT /);
    // sentencias del lector de preflight: exactamente dos lecturas fijas
    expect(PREFLIGHT_STATEMENTS).toEqual(["SELECT DATABASE() AS db, CURRENT_USER() AS account", "SHOW GRANTS FOR CURRENT_USER()"]);
  });

  it("API11.19 preflight de composición (API-20) contra MariaDB real: puertos reales + cifrado con adaptador KMS (cliente de laboratorio) + autoridad por registro + sesión y privilegios reales → PASS en LAB; el mismo preflight como PRODUCTION contra recursos de laboratorio NO pasa; no consume nonces ni cambia nada", async () => {
    const att = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    const KEY = randomBytes(32); const AUTH_KEY = randomBytes(32);
    const kmsEnv = { PRICESMART_KMS_TARGET: "LAB", PRICESMART_KMS_CURRENT_ALIAS: "lab.k1", PRICESMART_KMS_ALLOWED_ALIASES: "lab.k1" };
    const kmsClient = createLabKmsClient(["lab.k1"]); const kmsCfg = parseKmsConfig(kmsEnv); if (!kmsCfg.ok) throw new Error("config KMS");
    const kmsCipher = createProviderCipher({ provider: createKmsKeyProvider({ client: kmsClient, config: kmsCfg.config }), target: "LAB" });
    expect(await kmsCipher.open((await kmsCipher.seal({ externalOrderId: "API20" } as never, "ctx")).ciphertext, "lab.k1", "ctx")).toEqual({ externalOrderId: "API20" });
    const built = describeMariaDbComposition(ports, { cipher: { instance: kmsCipher, implementationId: "kms-provider-cipher", version: "api20-1" }, verifier: { instance: guardEvidenceVerifier(verifier), implementationId: "guarded-verifier", version: "api19-1" } });
    expect(built.missing).toEqual([]);
    const authority = createRegistryIdentityAuthority({ authorityId: "auth-lab-registry", target: "LAB", registry: att.registry, keys: { getKey: async () => AUTH_KEY } });
    const ids: Record<string, string> = { counter: "lab-counter-iso", replay: "lab-replay-iso", catalog: "lab-catalog", clock: "lab-clock", cipher: "lab-cipher", verifier: "lab-verifier" };
    for (const [port, d] of Object.entries(built.composition) as [string, { instance: object }][]) authority.enroll(d.instance, port as never, ids[port]);
    const trust = { lab: { "auth-lab-registry": AUTH_KEY }, production: { "auth-prod-registry": randomBytes(32) } };
    const issued = await issueAttestation({ composition: built.composition, target: "LAB", key: KEY, nowMs: Date.now(), ttlMs: 300000, identity: { authority, trusted: trust.lab } });
    expect(issued.claims.conformant && issued.claims.complete).toBe(true);
    const database = {
      lab: { host: "127.0.0.1", port: Number(process.env.DB_PORT), schema: manifest.schema, runtimeUser: manifest.user, registryWriterUser: "sandbox_api02_registry_writer", migrationUser: "sandbox_api02_migrator", runtimeHost: "127.0.0.1", registryWriterHost: "127.0.0.1", migrationHost: "127.0.0.1" },
      production: { host: "prod.interno.example", port: 3306, schema: "prod_pricesmart", runtimeUser: "ps_runtime", registryWriterUser: "ps_registry", migrationUser: "ps_migrator", runtimeHost: "localhost", registryWriterHost: "localhost", migrationHost: "localhost" },
    };
    const nonceRowsBefore = await n("ps_api18_attestation_nonces", "1 = 1");
    const common = { env: kmsEnv, kmsClient, database, db: mariaDbPreflightDatabase(pool), trust, attestation: { composition: built.composition, attestation: issued.attestation, key: KEY, authority, clock: ports.clock } };
    const labReport = await runProductionPreflight({ ...common, target: "LAB" });
    expect(labReport.checks.filter((c) => c.status !== "PASS")).toEqual([]); expect(labReport).toMatchObject({ passed: true, ready: false, authorizesInstallation: false });
    const again = await runProductionPreflight({ ...common, target: "LAB" }); expect(again.digest).toBe(labReport.digest);   // repetible: no consume nada
    expect(await n("ps_api18_attestation_nonces", "1 = 1")).toBe(nonceRowsBefore);
    // como PRODUCTION contra recursos de laboratorio: no pasa (sesión, KMS y atestación son de otro destino)
    const prodReport = await runProductionPreflight({ ...common, target: "PRODUCTION" });
    expect(prodReport.passed).toBe(false); expect(prodReport.checks.find((c) => c.id === "DB_SESSION_IDENTITY")).toMatchObject({ status: "FAIL", code: "SESSION_IDENTITY_MISMATCH" });
    expect(prodReport.checks.find((c) => c.id === "KMS_TARGET")).toMatchObject({ status: "FAIL" }); expect(prodReport.checks.find((c) => c.id === "ATTESTATION")?.status).toBe("FAIL");
    const text = JSON.stringify([labReport, prodReport]); for (const v of [KEY.toString("hex"), AUTH_KEY.toString("hex"), manifest.user, manifest.schema, "lab.k1"]) expect(text).not.toContain(v);
  });

  it("API11.20 cuentas por rol (API-21): el plan de privilegios se ejecuta sobre cuentas REALES y cada rol cumple SU política y no la de los otros; los privilegios cruzados fallan con errores reales del motor", async () => {
    const acc = await ensureLabAccounts(); const pools = { runtime: accountPool(acc.runtime), registryWriter: accountPool(acc.registryWriter), migration: accountPool(acc.migration) };
    try {
      for (const role of ["runtime", "registryWriter", "migration"] as AccountRole[]) {
        const db = mariaDbPreflightDatabase(pools[role] as never); const who = await db.identity();
        expect(who).toEqual({ db: manifest.schema, account: `${acc[role].user}@127.0.0.1` });
        const lines = await db.grants(); expect(auditRoleGrants(role, lines, { schema: manifest.schema })).toEqual({ ok: true, complete: true, findings: [], missing: [] });
        for (const other of ["runtime", "registryWriter", "migration"] as AccountRole[]) if (other !== role) { const a = auditRoleGrants(other, lines, { schema: manifest.schema }); expect(a.ok && a.complete, `${role} como ${other}`).toBe(false); }
      }
      const q = (role: AccountRole, sql: string) => errno(pools[role].query(sql));
      const reg = `${T}.ps_api18_resource_registry`; const nonces = `${T}.ps_api18_attestation_nonces`;
      // ejecución: no escribe el registro, no hace DDL, no borra
      expect(await q("runtime", `INSERT INTO ${reg} (target, port, resource_id, subject, status) VALUES ('LAB', 'clock', _binary'p21-x', 'LIVE', 'ACTIVE')`)).toBe(1142);
      expect(await q("runtime", `DELETE FROM ${T}.ps_api11_proof_claims WHERE 1 = 0`)).toBe(1142); expect(await q("runtime", `CREATE TABLE ${T}.p21_runtime_no (id INT)`)).toBe(1142);
      // registro: alta y retiro (solo la columna status), nada más
      expect(await q("registryWriter", `INSERT INTO ${reg} (target, port, resource_id, subject, status) VALUES ('LAB', 'clock', _binary'p21-${randomBytes(3).toString("hex")}', 'LIVE', 'ACTIVE')`)).toBe(0);
      expect(await q("registryWriter", `UPDATE ${reg} SET status = 'RETIRED' WHERE resource_id = _binary'p21-none'`)).toBe(0);
      expect(await q("registryWriter", `UPDATE ${reg} SET subject = 'LIVE' WHERE 1 = 0`)).toBe(1143); expect(await q("registryWriter", `DELETE FROM ${reg} WHERE 1 = 0`)).toBe(1142);
      expect(await q("registryWriter", `SELECT 1 FROM ${nonces} LIMIT 1`)).toBe(1142); expect(await q("registryWriter", `INSERT INTO ${nonces} (target, nonce_hash, expires_at_ms) VALUES ('LAB', _binary'0123456789abcdef0123456789abcdef', 1)`)).toBe(1142);
      // migración: DDL aditivo sí; datos, DROP y TRUNCATE no
      const tmp = `${T}.p21_tmp_${randomBytes(3).toString("hex")}`;
      expect(await q("migration", `CREATE TABLE ${tmp} (id INT PRIMARY KEY)`)).toBe(0); expect(await q("migration", `ALTER TABLE ${tmp} ADD COLUMN c INT NULL`)).toBe(0);
      expect(await q("migration", `INSERT INTO ${tmp} (id) VALUES (1)`)).toBe(1142); expect(await q("migration", `SELECT * FROM ${tmp}`)).toBe(1142); expect(await q("migration", `DROP TABLE ${tmp}`)).toBe(1142); expect(await q("migration", `SELECT 1 FROM ${reg} LIMIT 1`)).toBe(1142);
    } finally { await Promise.all(Object.values(pools).map((p) => p.end())); }
  });

  it("API11.21 preflight de composición (API-21) contra MariaDB real con TRES sesiones: pasa en LAB con un adaptador KMS aprobado; falla cerrado sin proveedor revisado, con privilegios en exceso, con cuentas repetidas y para PRODUCCIÓN contra recursos de laboratorio", async () => {
    const acc = await ensureLabAccounts(); const regPool = accountPool(acc.registryWriter); const migPool = accountPool(acc.migration);
    const att = mariaDbAttestationPorts(pool, { schema: manifest.schema, runtimeUser: manifest.user, target: "LAB" });
    const KEY = randomBytes(32); const AUTH_KEY = randomBytes(32);
    const kmsClient = createLabKmsClient(["lab.k1"]); const adapters: KmsAdapterRegistry = { "lab-memoria": { targets: ["LAB"], create: () => kmsClient } };
    const env = {
      PRICESMART_COMPOSITION_TARGET: "LAB", PRICESMART_KMS_TARGET: "LAB", PRICESMART_KMS_CURRENT_ALIAS: "lab.k1", PRICESMART_KMS_ALLOWED_ALIASES: "lab.k1", PRICESMART_KMS_PROVIDER: "lab-memoria", PRICESMART_KMS_SERVICE_IDENTITY: "identidad-lab",
      PRICESMART_DB_HOST: "127.0.0.1", PRICESMART_DB_PORT: String(process.env.DB_PORT), PRICESMART_DB_SCHEMA: manifest.schema, PRICESMART_DB_RUNTIME_USER: manifest.user, PRICESMART_DB_RUNTIME_HOST: "127.0.0.1",
      PRICESMART_DB_REGISTRY_WRITER_USER: acc.registryWriter.user, PRICESMART_DB_REGISTRY_WRITER_HOST: "127.0.0.1", PRICESMART_DB_MIGRATION_USER: acc.migration.user, PRICESMART_DB_MIGRATION_HOST: "127.0.0.1",
    };
    try {
      const kmsCfg = parseKmsConfig(env); if (!kmsCfg.ok) throw new Error("config KMS");
      const kmsCipher = createProviderCipher({ provider: createKmsKeyProvider({ client: kmsClient, config: kmsCfg.config }), target: "LAB" });
      const built = describeMariaDbComposition(ports, { cipher: { instance: kmsCipher, implementationId: "kms-provider-cipher", version: "api21-1" }, verifier: { instance: guardEvidenceVerifier(verifier), implementationId: "guarded-verifier", version: "api19-1" } });
      expect(built.missing).toEqual([]);
      const authority = createRegistryIdentityAuthority({ authorityId: "auth-lab-registry", target: "LAB", registry: att.registry, keys: { getKey: async () => AUTH_KEY } });
      const ids: Record<string, string> = { counter: "lab-counter-iso", replay: "lab-replay-iso", catalog: "lab-catalog", clock: "lab-clock", cipher: "lab-cipher", verifier: "lab-verifier" };
      for (const [port, d] of Object.entries(built.composition) as [string, { instance: object }][]) authority.enroll(d.instance, port as never, ids[port]);
      const trust = { lab: { "auth-lab-registry": AUTH_KEY }, production: { "auth-prod-registry": randomBytes(32) } };
      const issued = await issueAttestation({ composition: built.composition, target: "LAB", key: KEY, nowMs: Date.now(), ttlMs: 300000, identity: { authority, trusted: trust.lab } });
      const dbs = () => ({ runtime: mariaDbPreflightDatabase(pool), registryWriter: mariaDbPreflightDatabase(regPool as never), migration: mariaDbPreflightDatabase(migPool as never) });
      const common = { env, adapters, trust, attestation: { composition: built.composition, attestation: issued.attestation, key: KEY, authority, clock: ports.clock } };
      const nonceRows = await n("ps_api18_attestation_nonces", "1 = 1");
      const good = await runCompositionPreflight({ ...common, databases: dbs() });
      expect(good.checks.filter((c) => c.status !== "PASS")).toEqual([]); expect(good).toMatchObject({ passed: true, target: "LAB", ready: false, authorizesInstallation: false });
      expect((await runCompositionPreflight({ ...common, databases: dbs() })).digest).toBe(good.digest); expect(await n("ps_api18_attestation_nonces", "1 = 1")).toBe(nonceRows);
      // sin proveedor KMS revisado (el registro del repositorio está vacío): falla cerrado
      const closed = await runCompositionPreflight({ ...common, adapters: REVIEWED_KMS_ADAPTERS, databases: dbs() }); expect(closed.passed).toBe(false); expect(closed.checks.find((c) => c.id === "KMS_PROVIDER")).toMatchObject({ status: "FAIL", code: "KMS_PROVIDER_NOT_SELECTED" });
      // privilegio en exceso REAL en la cuenta del registro → falla; al revocarlo vuelve a pasar
      const adminConn = await mysql.createConnection(adminOptions(manifest));
      try {
        await adminConn.query(`GRANT DELETE ON ${T}.ps_api18_resource_registry TO ?@'127.0.0.1'`, [acc.registryWriter.user]);
        const over = await runCompositionPreflight({ ...common, databases: dbs() }); expect(over.passed).toBe(false); expect(over.checks.find((c) => c.id === "ACCOUNT_REGISTRY_WRITER_GRANTS")).toMatchObject({ status: "FAIL", code: "EXCESS_PRIVILEGE" });
        await adminConn.query(`REVOKE DELETE ON ${T}.ps_api18_resource_registry FROM ?@'127.0.0.1'`, [acc.registryWriter.user]);
      } finally { await adminConn.end(); }
      expect((await runCompositionPreflight({ ...common, databases: dbs() })).passed).toBe(true);
      // la misma sesión de ejecución usada como cuenta del registro: identidad y separación fallan
      const dup = await runCompositionPreflight({ ...common, databases: { ...dbs(), registryWriter: mariaDbPreflightDatabase(pool) } });
      expect(dup.passed).toBe(false); expect(dup.checks.find((c) => c.id === "ACCOUNT_REGISTRY_WRITER_SESSION")?.status).toBe("FAIL"); expect(dup.checks.find((c) => c.id === "ACCOUNTS_DISTINCT")?.status).toBe("FAIL");
      // PRODUCCIÓN contra recursos de laboratorio: la configuración es inválida (nombres, hosts y alias de laboratorio) y nada pasa
      const prod = await runCompositionPreflight({ ...common, env: { ...env, PRICESMART_COMPOSITION_TARGET: "PRODUCTION" }, databases: dbs() }); expect(prod.passed).toBe(false); expect(prod.checks.find((c) => c.id === "COMPOSITION_CONFIG")).toMatchObject({ status: "FAIL", code: "COMPOSITION_CONFIG_INVALID" });
      const text = JSON.stringify([good, closed, dup, prod]); for (const v of [KEY.toString("hex"), AUTH_KEY.toString("hex"), acc.registryWriter.password, acc.migration.password, acc.registryWriter.user, acc.migration.user, manifest.user, manifest.schema]) expect(text).not.toContain(v);
    } finally { await Promise.all([regPool.end(), migPool.end()]); }
  });
});

// PRICESMART-API-26 — la COMPOSICIÓN del sandbox de homologación (`homologation/runtime.ts`) contra MariaDB 11.8.9 real, EN PROCESO y con las cuentas de MÍNIMO privilegio generadas por el paquete de aprovisionamiento
// (aplicación, worker y monitor; `demo.mjs prepare-homologation`). Si falta un privilegio, el flujo falla. El verificador/cifrado/contrato son DOBLES DE PRUEBA en proceso (no existe un verificador acordado: D02, ni un contrato
// definitivo: D06); no hay acceso externo. Solo se ejecuta desde demo.mjs. Las «decisiones ratificadas» del entorno de esta prueba son una DECLARACIÓN DE LA PRUEBA, no una ratificación de PriceSmart.
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sandboxPool } from "@/lib/sandbox-db";
import { createHomologationRuntime, fileKillSwitch, type HomologationRuntime } from "../../../src/lib/integrations/pricesmart/homologation/runtime";
import { evaluateReadiness, installControlledRuntime } from "../../../src/lib/integrations/pricesmart/runtime-assembly";
import { handlePriceSmart, isPriceSmartHandlerInstalled, installPriceSmartHandler } from "../../../src/lib/integrations/pricesmart/runtime";
import { ENABLE_ACK } from "../../../src/lib/integrations/pricesmart/runtime-config";
import { labContract } from "../../../src/lib/integrations/pricesmart/lab-demo/contract";
import { labCipher, labEvidencePort, labVerifier } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-crypto";
import * as B from "../pricesmart-homologation/bundle.mjs";
import { BASE, CLUB, INTEGRATION, connect, empresas, evidence, labKey, labOrder, state, uid, type Key, type Row } from "./e2e-support";

type Account = { user: string; password: string };
const homolog = (state.demo as unknown as { homolog: { names: { schema: string }; app: Account; worker: Account; monitor: Account } }).homolog;
const schema = homolog.names.schema; const API = "/api/integrations/pricesmart/v1/orders";
let ctx: Awaited<ReturnType<typeof connect>>; let runtime: HomologationRuntime; let killFile = ""; const raws: mysql.Pool[] = [];
const rawPool = (a: Account) => { const p = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: a.user, password: a.password, database: schema, connectionLimit: 15 }); raws.push(p); return sandboxPool(p); };
const baseEnv = (mode: string, decisions = "D02,D06,D08,D09,D12") => ({
  NODE_ENV: "production", NOVALVION_ENV: "sandbox",   // `next start` fija NODE_ENV=production también en el sandbox (API-26)
  PRICESMART_RUNTIME_MODE: mode, PRICESMART_RUNTIME_ACK: ENABLE_ACK, PRICESMART_RUNTIME_ENVIRONMENT: "sandbox", PRICESMART_ORIGIN_CLUB: CLUB, PRICESMART_DB_SCHEMA: schema, PRICESMART_DB_RUNTIME_USER: homolog.app.user,
  PRICESMART_RATIFIED_DECISIONS: decisions, PRICESMART_RATE_PER_WINDOW: "5000", PRICESMART_RATE_WINDOW_MS: "60000",
});

async function send(method: "GET" | "POST", p: string, op: "orders:create" | "orders:read" | "orders:cancel", key: Key | string | null, id: string, body?: unknown, over: Parameters<typeof evidence>[4] = {}): Promise<{ status: number; json: Row }> {
  const bytes = body === undefined ? new Uint8Array(0) : new TextEncoder().encode(JSON.stringify(body));
  const headers: Record<string, string> = { accept: "application/json" }; if (method === "POST") headers["content-type"] = "application/json";
  if (key) headers["x-lab-evidence"] = evidence(key as Key, op, id, bytes, over);
  const res = await handlePriceSmart(new Request(`${BASE}${p}`, { method, headers, body: method === "POST" ? Buffer.from(bytes) : undefined }));
  return { status: res.status, json: (await res.json()) as Row };
}
const post = (key: Key | string | null, id: string, body: unknown = labOrder(id), over?: Parameters<typeof evidence>[4]) => send("POST", API, "orders:create", key, id, body, over);
const get = (key: Key | string | null, id: string) => send("GET", `${API}/${id}`, "orders:read", key, id);
const cancel = (key: Key | string | null, id: string, reason = "ORIGIN_REQUEST") => send("POST", `${API}/${id}/cancellation-requests`, "orders:cancel", key, id, { reason });
const A = () => empresas.a.empresaId;
const outboxOf = async (id: string) => ctx.rows("SELECT order_version v, status, attempts FROM ps_api01_outbox WHERE order_id = (SELECT id FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?) ORDER BY order_version", [A(), Buffer.from(id)]);
const solicitudes = (id: string) => ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id]);
const retryDeadlock = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i < 8 && (e as { code?: string }).code === "ER_LOCK_DEADLOCK") continue; throw e; } } };   // el UPDATE administrativo de la prueba puede cruzarse con el reclamo del consumidor
async function drain(ids: string[], rounds = 40) {
  for (let i = 0; i < rounds; i++) {
    await runtime.consumer.runOnce();
    let open = 0; for (const id of ids) open += (await outboxOf(id)).filter((o) => o.status === "PENDING" || o.status === "LEASED").length;
    if (!open) return;
    await retryDeadlock(() => ctx.db.query("UPDATE ps_api01_outbox SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING'")); await retryDeadlock(() => ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING' AND lease_until IS NULL"));
  }
}
async function withoutMapping<T>(fn: (restore: () => Promise<void>) => Promise<T>): Promise<T> {
  const rows = await ctx.rows("SELECT * FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = 1", [A()]); await ctx.db.query("DELETE FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = 1", [A()]);
  let done = false; const restore = async () => { if (done) return; done = true; for (const m of rows) await ctx.db.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (?,?,?,?,?,?,?,?,?)", [m.environment, m.tenant_id, m.client_id, m.integration_id, m.empresa_id, m.tms_cliente_id, m.tms_usuario_cliente_id, m.pickup_place, m.dropoff_place]); };
  try { return await fn(restore); } finally { await restore(); }
}

beforeAll(async () => {
  ctx = await connect(); killFile = path.join(mkdtempSync(path.join(os.tmpdir(), "ps-hom-")), "killswitch"); writeFileSync(killFile, "ON\n");
  runtime = createHomologationRuntime({ pool: rawPool(homolog.app), workerPool: rawPool(homolog.worker), schema, runtimeUser: homolog.app.user, workerUser: homolog.worker.user,
    evidence: labEvidencePort(), verifier: labVerifier(labKey), cipher: labCipher(labKey), contract: labContract, killSwitch: fileKillSwitch(killFile) });
});
afterAll(async () => { runtime?.consumer.stop(); installPriceSmartHandler(null); await ctx.db.end(); for (const r of raws) await r.end(); });

describe("API-26 composición de homologación con cuentas de mínimo privilegio (MariaDB real)", () => {
  it("R0 sin decisiones ratificadas el runtime NO se instala y las rutas responden 503 DISABLED; NODE_ENV=production por sí solo sigue bloqueado, pero en un proceso declarado sandbox no bloquea", async () => {
    const off = await installControlledRuntime(baseEnv("ENABLED", "D02"), runtime.ports);
    expect(off.ready).toBe(false); expect(off.blockers.map((b) => b.code)).toContain("DECISION_PENDING"); expect(isPriceSmartHandlerInstalled()).toBe(false);
    const r = await post("a", uid()); expect(r.status).toBe(503); expect(r.json.code).toBe("DISABLED");
    const prod = await evaluateReadiness({ ...baseEnv("ENABLED"), NOVALVION_ENV: undefined }, runtime.ports); expect(prod.blockers.map((b) => b.code)).toContain("PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED");
    const prod2 = await evaluateReadiness({ ...baseEnv("ENABLED"), NOVALVION_ENV: "production" }, runtime.ports); expect(prod2.blockers.map((b) => b.code)).toContain("PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED");
    const sandbox = await evaluateReadiness(baseEnv("ENABLED"), runtime.ports); expect(sandbox.blockers).toEqual([]); expect(sandbox.ready).toBe(true);
  });

  it("R1 con todo declarado el runtime queda instalado; 30 órdenes SIMULTÁNEAS se reciben (202) y el consumidor de la outbox las vincula al TMS con las cuentas mínimas: una solicitud por orden, outbox DONE", async () => {
    const report = await installControlledRuntime(baseEnv("ENABLED"), runtime.ports); expect(report, JSON.stringify(report)).toMatchObject({ ready: true, mode: "ENABLED" }); expect(isPriceSmartHandlerInstalled()).toBe(true);
    const ids = Array.from({ length: 30 }, () => uid()); const sent = await Promise.all(ids.map((id) => post("a", id)));
    expect(sent.map((s) => s.status), JSON.stringify(sent.find((s) => s.status !== 202)?.json)).toEqual(Array(30).fill(202));
    await drain(ids);
    for (const id of ids) { expect(await solicitudes(id), id).toBe(1); expect((await outboxOf(id)).every((o) => o.status === "DONE"), id).toBe(true); }
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id IN (?)", [A(), ids.map((i) => Buffer.from(i))])).toBe(30);
  }, 240000);

  it("R2 consulta periódica: 40 GET simultáneos de la MISMA credencial → todos 200 (sin 503), vinculados y sin afirmar entrega", async () => {
    const ids = Array.from({ length: 8 }, () => uid()); await Promise.all(ids.map((id) => post("a", id))); await drain(ids);
    const res = await Promise.all(Array.from({ length: 40 }, (_, i) => get("a", ids[i % ids.length])));
    expect(res.map((r) => r.status), JSON.stringify(res.find((r) => r.status !== 200)?.json)).toEqual(Array(40).fill(200));
    for (const r of res) { expect(r.json).toMatchObject({ confirmsDelivery: false, tms: { linked: true, requestState: "SOLICITADA" } }); expect(JSON.stringify(r.json)).not.toMatch(/Avenida Ficticia|Club Ficticio|DELIVERED|ENTREGAD/i); }
  }, 240000);

  it("R3 idempotencia y duplicados: 8 POST simultáneos de la misma orden → todos 202, UNA orden y UNA solicitud; mismo id con otro contenido → 409; los reintentos de la consulta no escriben nada de negocio", async () => {
    const id = uid(); const all = await Promise.all(Array.from({ length: 8 }, () => post("a", id))); expect(all.map((r) => r.status)).toEqual(Array(8).fill(202));
    await drain([id]); expect(await solicitudes(id)).toBe(1); expect((await post("a", id, labOrder(id, { address: "Otra dirección ficticia 5" }))).status).toBe(409);
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [A(), Buffer.from(id)])).toBe(1);
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api01_outbox o JOIN ps_api01_orders r ON r.id = o.order_id WHERE r.external_order_id = ?", [Buffer.from(id)])).toBe(1);
  }, 240000);

  it("R4 cancelación DESPUÉS de vincular: la outbox deja UNA constancia y UNA auditoría (cuenta mínima), sin cancelar la solicitud; ANTES de vincular: la orden no se vincula nunca", async () => {
    const linked = uid(); expect((await post("a", linked)).status).toBe(202); await drain([linked]); expect(await solicitudes(linked)).toBe(1);
    expect((await cancel("a", linked)).status).toBe(202); await drain([linked]);
    expect(await ctx.count("SELECT COUNT(*) n FROM auditoria WHERE accion = 'pricesmart_cancelacion_solicitada' AND detalle LIKE ?", [`%${linked}%`])).toBe(1);
    expect((await get("a", linked)).json).toMatchObject({ cancellation: { requested: true, automatic: false }, tms: { requestState: "SOLICITADA" } });
    // Sin mapeo el consumidor (que arranca al recibir la orden) no puede vincularla: la cancelación llega ANTES de la vinculación; al volver el TMS la orden cancelada no se vincula.
    const early = uid(); await withoutMapping(async (restore) => { expect((await post("a", early)).status).toBe(202); expect((await cancel("a", early)).status).toBe(202); await runtime.consumer.runOnce(); await restore(); }); await drain([early]); expect(await solicitudes(early)).toBe(0);
    expect((await outboxOf(early)).every((o) => o.status === "DONE")).toBe(true);
  }, 240000);

  it("R5 fallo y recuperación del TMS: sin mapeo la orden se reintenta (nunca DONE ni pérdida) y, al volver, se vincula una sola vez", async () => {
    const id = uid();
    await withoutMapping(async (restore) => {
      expect((await post("a", id)).status).toBe(202); await runtime.consumer.runOnce(); expect(await solicitudes(id)).toBe(0); expect((await outboxOf(id))[0].status).not.toBe("DONE");
      await restore();
    });
    await drain([id]); expect(await solicitudes(id)).toBe(1); expect((await outboxOf(id))[0].status).toBe("DONE");
  }, 240000);

  it("R6 seguridad: sin evidencia/firma alterada/desconocida/revocada → 401; otra empresa → 404; credencial nueva se REVOCA con las funciones del paquete y deja de valer al instante (sin reinicio)", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    for (const k of [null, "ghost", "rev"] as const) expect((await post(k, uid())).status, String(k)).toBe(401); expect((await post("a", uid(), undefined, { tamper: true })).status).toBe(401);
    expect((await get("b", id)).status).toBe(404); expect((await cancel("b", id)).status).toBe(404);
    const FROM = Date.now() - 60_000; const hr = `hr${Date.now().toString(36)}`;   // credencial NUEVA por ejecución (el laboratorio conserva sus filas entre ejecuciones)
    const reg = B.registerIntegrationStatement({ issuer: "lab-issuer", subject: `lab-subject-${hr}`, credentialReference: `lab-cred-${hr}-1`, tenantId: A(), clientId: 1, integrationId: INTEGRATION, allowedClubs: [CLUB], scopes: ["orders:create", "orders:read"], validFromMs: FROM, validUntilMs: FROM + 86_400_000 });
    await ctx.db.query(reg.sql, reg.params); expect((await post(hr, uid())).status).toBe(202); expect((await cancel(hr, id)).status).toBe(403);   // sin el permiso de cancelar
    const rev = B.revokeStatement({ issuer: "lab-issuer", subject: `lab-subject-${hr}`, credentialReference: `lab-cred-${hr}-1` }); await ctx.db.query(rev.sql, rev.params);
    expect((await post(hr, uid())).status).toBe(401); expect((await get(hr, id)).status).toBe(401);
  }, 240000);

  it("R7 interruptor de emergencia y modos: archivo ausente/OFF/ilegible → 503 DISABLED al instante; ON → opera; READ_ONLY → GET sí, POST 503 READ_ONLY", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    writeFileSync(killFile, "OFF"); for (const r of [await post("a", uid()), await get("a", id)]) { expect(r.status).toBe(503); expect(r.json.code).toBe("DISABLED"); }
    writeFileSync(killFile, "basura"); expect((await get("a", id)).status).toBe(503); writeFileSync(killFile, "ON\n"); expect((await get("a", id)).status).toBe(200);
    expect((await installControlledRuntime(baseEnv("READ_ONLY", "D02,D06"), runtime.ports)).ready).toBe(true);
    const ro = await post("a", uid()); expect(ro.status).toBe(503); expect(ro.json.code).toBe("READ_ONLY"); expect((await get("a", id)).status).toBe(200);
    expect((await installControlledRuntime(baseEnv("ENABLED"), runtime.ports)).ready).toBe(true); expect((await post("a", uid())).status).toBe(202);
  }, 240000);

  it("R8 mínimo privilegio EN EJECUCIÓN: la cuenta de la aplicación y la del worker no pueden borrar, alterar la cola ni leer lo que no les corresponde; el monitor ve contadores consistentes y no puede escribir", async () => {
    const appPool = rawPool(homolog.app); const workerPool = rawPool(homolog.worker); const denied = async (p: Promise<unknown>) => { try { await p; return "OK"; } catch (e) { return (e as { errno?: number }).errno ?? "ERR"; } };
    for (const sql of ["DELETE FROM ps_api01_orders", "UPDATE ps_api01_outbox SET status = 'DONE'", "DROP TABLE ps_api01_audit", "DELETE FROM auditoria"]) expect(await denied(appPool.execute(sql)), sql).toBeOneOf([1142, 1143, 1044, 1227]);
    for (const sql of ["SELECT payload_ciphertext FROM ps_api01_orders", "DELETE FROM ps_api01_outbox", "SELECT * FROM ps_api11_integrations", "INSERT INTO ps_api01_outbox (environment) VALUES (1)"]) expect(await denied(workerPool.execute(sql)), sql).toBeOneOf([1142, 1143, 1044, 1227]);
    const monitor = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: homolog.monitor.user, password: homolog.monitor.password, database: schema });
    try {
      const [[pending]] = (await monitor.query(B.MONITORING_QUERIES.outbox_pending)) as unknown as [Row[]]; const [[review]] = (await monitor.query(B.MONITORING_QUERIES.outbox_review)) as unknown as [Row[]]; const [[blocked]] = (await monitor.query(B.MONITORING_QUERIES.link_jobs_blocked)) as unknown as [Row[]];
      expect(Number(pending.n)).toBe(await ctx.count("SELECT COUNT(*) n FROM ps_api01_outbox WHERE status = 'PENDING' AND next_attempt_at <= UTC_TIMESTAMP(6)")); expect(Number(review.n)).toBe(await ctx.count("SELECT COUNT(*) n FROM ps_api01_outbox WHERE status = 'REVIEW'"));
      expect(Number(blocked.n)).toBe(await ctx.count("SELECT COUNT(*) n FROM ps_api13_link_jobs WHERE status IN ('BLOCKED','EXHAUSTED')"));
      expect(await denied(monitor.query("UPDATE ps_api01_outbox SET status = 'DONE'"))).toBeOneOf([1142, 1143, 1044, 1227]); expect(await denied(monitor.query("SELECT payload_ciphertext FROM ps_api01_orders"))).toBeOneOf([1142, 1143, 1044, 1227]);
    } finally { await monitor.end(); }
  }, 240000);

  it("R9 las respuestas y errores del runtime compuesto no exponen datos de la orden ni detalles internos", async () => {
    const tag = uid(); const id = uid(); const sent = labOrder(id, { recipient: { name: `Dest-${tag}` }, address: `Calle-${tag} 12`, notes: `Nota-${tag}` });
    const out = [await post("a", id, sent), await get("a", id), await cancel("a", id), await get("b", id), await post("a", uid(), { ...sent, extra: tag }), await post(null, id, sent)];
    const text = JSON.stringify(out.map((o) => o.json)); expect(text).not.toContain(tag); expect(text).not.toMatch(/sandbox_api02|payload|ciphertext|SELECT |INSERT |mysql|ER_/i);
    for (const o of out.filter((x) => x.status >= 400)) expect(Object.keys(o.json).sort()).toEqual(["code", "correlationId"]);
  }, 120000);
});

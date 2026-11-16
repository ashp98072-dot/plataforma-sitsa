// PRICESMART-API-23 — flujo FUNCIONAL completo, sintético y aislado: PriceSmart → seguridad M2M → persistencia → evento + outbox → procesamiento de la outbox → vinculación al TMS de laboratorio → estado → cancelación,
// con reintentos, caída/recuperación, duplicados, concurrencia y pruebas adversarias. Contra la app real (`next dev`) y MariaDB 11.8.9 desechable. Solo se ejecuta desde demo.mjs. No crea viajes ni toca nada fuera del laboratorio.
// Las órdenes entran SIEMPRE por HTTP (con evidencia M2M de laboratorio); el procesamiento de la outbox lo hace el despachador REAL de API-07 (almacén MariaDB real con la cuenta de worker de mínimo privilegio)
// con el manejador de API-23, que reutiliza la vinculación idempotente de API-12/13. La vía rápida de la app puede adelantarse: el flujo debe ser idempotente.
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "@/lib/db";
import { sandboxPool } from "@/lib/sandbox-db";
import { mariaDbOrderRepository } from "../../../src/lib/integrations/pricesmart/mariadb-repository";
import { labContract } from "../../../src/lib/integrations/pricesmart/lab-demo/contract";
import { labCipher } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-crypto";
import { createLinkRetry } from "../../../src/lib/integrations/pricesmart/lab-demo/link-retry";
import { createTmsLinker } from "../../../src/lib/integrations/pricesmart/lab-demo/tms-link";
import { createLinkOutboxHandler } from "../../../src/lib/integrations/pricesmart/lab-demo/outbox-link-handler";
import { OutboxDispatcher, type OutboxLogEntry, type OutboxPolicy } from "../../../src/lib/integrations/pricesmart/outbox";
import { mariaDbOutboxStore } from "../../../src/lib/integrations/pricesmart/outbox-mariadb";
import { cancel, connect, empresas, get, labKey, post, scopeFull, uid, labOrder, API, call, type Key, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>;
const schema = String(process.env.DB_NAME); const workerUser = String(process.env.PS_DEMO_WORKER_USER);
const workerRaws: mysql.Pool[] = [];
const workerStore = () => {
  const raw = mysql.createPool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: workerUser, password: process.env.PS06A_WORKER_PASSWORD, database: schema, connectionLimit: 4 });
  workerRaws.push(raw); return mariaDbOutboxStore(sandboxPool(raw), { schema, workerUser });
};
const POLICY: OutboxPolicy = { batchSize: 100, leaseMs: 2000, maxAttempts: 10, backoffBaseMs: 1, backoffMaxMs: 1 };
const log: OutboxLogEntry[] = [];
let handler: ReturnType<typeof createLinkOutboxHandler>; let linker: ReturnType<typeof createTmsLinker>; let retry: ReturnType<typeof createLinkRetry>;
const dispatcher = (policy = POLICY, store = workerStore(), h: { handle: typeof handler.handle } = handler) => new OutboxDispatcher(store, h as never, policy, (e) => log.push(e));

beforeAll(async () => {
  ctx = await connect();
  const pool = getPool();   // pool de EJECUCIÓN verificado de sandbox (NODE_ENV=test + NOVALVION_ENV=sandbox)
  const repository = mariaDbOrderRepository(pool, { schema, runtimeUser: String(process.env.DB_USER), cipher: labCipher(labKey), contract: labContract });
  linker = createTmsLinker({ pool, schema, repository }); retry = createLinkRetry({ pool, schema, linker });
  handler = createLinkOutboxHandler({ pool, schema, retry, linker });
});
afterAll(async () => { await ctx.db.end(); for (const r of workerRaws) await r.end(); });

const hex = async (id: string, key: Key = "a") => String((await ctx.rows("SELECT HEX(id) h FROM ps_api01_orders WHERE tenant_id = ? AND client_id = ? AND external_order_id = ?", [scopeFull(key).tenantId, scopeFull(key).clientId, Buffer.from(id)]))[0]?.h);
const outbox = async (id: string, key: Key = "a") => ctx.rows("SELECT order_version v, status, attempts FROM ps_api01_outbox WHERE order_id = UNHEX(?) ORDER BY order_version", [await hex(id, key)]);
const solicitudes = async (id: string, empresaId = empresas.a.empresaId) => ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresaId, id]);
const planes = () => ctx.count("SELECT COUNT(*) n FROM tms_planes_viaje");
const retryDeadlock = async <T>(fn: () => Promise<T>): Promise<T> => { for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i < 6 && (e as { code?: string }).code === "ER_LOCK_DEADLOCK") continue; throw e; } } };   // el UPDATE administrativo de la prueba puede cruzarse con el reclamo del despachador
const dueNow = async (id: string, key: Key = "a") => {   // adelanta el vencimiento de reintentos (solo laboratorio)
  const h = await hex(id, key);
  await retryDeadlock(() => ctx.db.query("UPDATE ps_api01_outbox SET next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND status = 'PENDING'", [h]));
  await retryDeadlock(() => ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND status = 'PENDING' AND lease_until IS NULL", [h]));
};
async function withoutMapping<T>(key: Key, fn: (restore: () => Promise<void>) => Promise<T>): Promise<T> {
  const s = scopeFull(key); const saved = await ctx.rows("SELECT * FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  await ctx.db.query("DELETE FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  let restored = false;
  const restore = async () => { if (restored) return; restored = true; for (const m of saved as Row[]) await ctx.db.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (?,?,?,?,?,?,?,?,?)",
    [m.environment, m.tenant_id, m.client_id, m.integration_id, m.empresa_id, m.tms_cliente_id, m.tms_usuario_cliente_id, m.pickup_place, m.dropoff_place]); };
  try { return await fn(restore); } finally { await restore(); }
}
/** Corre el despachador hasta que las órdenes indicadas dejen de estar PENDING/LEASED en la outbox o se agote el número de rondas. */
async function drain(ids: string[], d = dispatcher(), rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await d.runOnce();
    let open = 0; for (const id of ids) open += (await outbox(id)).filter((o) => o.status === "PENDING" || o.status === "LEASED").length;
    if (!open) return; await new Promise((r) => setTimeout(r, 50)); for (const id of ids) await dueNow(id);
  }
}

describe("API-23 flujo funcional PriceSmart → M2M → persistencia → outbox → TMS (laboratorio)", () => {
  it("F1 la cuenta de worker de la outbox es de MÍNIMO privilegio: no puede insertar ni borrar órdenes/eventos/outbox ni leer el payload cifrado", async () => {
    const w = await mysql.createConnection({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: workerUser, password: process.env.PS06A_WORKER_PASSWORD, database: schema });
    try {
      for (const sql of ["DELETE FROM ps_api01_outbox", "INSERT INTO ps_api01_outbox (environment) VALUES (_binary'sandbox')", "SELECT payload_ciphertext FROM ps_api01_orders LIMIT 1", "UPDATE ps_api01_orders SET state = 'X'", "SELECT * FROM tms_solicitudes_cliente LIMIT 1", "DROP TABLE ps_api01_outbox"])
        await expect(w.query(sql), sql).rejects.toMatchObject({ code: expect.stringMatching(/ER_(TABLEACCESS|COLUMNACCESS|DBACCESS|SPECIFIC_ACCESS)_DENIED_ERROR|ER_TABLEACCESS_DENIED_ERROR/) });
    } finally { await w.end(); }
  });

  it("F2 flujo completo con fallo transitorio y recuperación: orden → M2M → persistida → evento+outbox → (sin mapeo: RETRY) → (mapeo restaurado: DONE) → una solicitud TMS → estado → sin viajes", async () => {
    const id = uid(); const planesAntes = await planes(); let restoreMapping = async () => {};
    await withoutMapping("a", async (restore) => {
      restoreMapping = restore;
      const r = await post("a", id); expect(r.status).toBe(202); expect(r.json).toMatchObject({ provisionalStatus: "RECEIVED", processingStatus: "PENDING", version: 1 });
      expect(await outbox(id)).toEqual([expect.objectContaining({ v: 1, status: "PENDING" })]);
      expect(await solicitudes(id)).toBe(0);   // el TMS todavía no tiene nada: la falla fue transitoria
      await dueNow(id); await drain([id], dispatcher(), 1);   // 1.ª ronda con el TMS sin mapeo → el manejador pide REINTENTO (la orden NO se pierde ni se marca DONE)
      const ob = await outbox(id); expect(ob[0].status).toBe("PENDING"); expect(Number(ob[0].attempts)).toBeGreaterThanOrEqual(1);
      expect(await solicitudes(id)).toBe(0);
    });
    await restoreMapping();   // el TMS vuelve
    await dueNow(id); await drain([id]);
    expect((await outbox(id))[0].status).toBe("DONE"); expect(await solicitudes(id)).toBe(1);
    const log13 = await ctx.rows("SELECT outcome, worker_id FROM ps_api13_link_attempts WHERE event='FINISHED' AND order_id = UNHEX(?) ORDER BY attempt_no", [await hex(id)]);
    expect(log13.map((l) => l.outcome)).toContain("UNMAPPED"); expect(log13.map((l) => l.outcome)).toContain("LINKED"); expect(log13.at(-1)!.worker_id).toBe("outbox");   // la vinculó el consumidor de la outbox
    const st = await get("a", id); expect(st.status).toBe(200);
    expect(st.json).toMatchObject({ externalOrderId: id, confirmsDelivery: false, tms: { linked: true, requestState: "SOLICITADA", scheduled: false } }); expect(JSON.stringify(st.json)).not.toMatch(/DELIVERED|ENTREGAD/i);
    expect(await planes()).toBe(planesAntes);   // ningún viaje real creado
    expect(JSON.stringify(log)).not.toMatch(/Avenida|Club Ficticio/);   // el registro del despachador no contiene datos de la orden
  });

  it("F3 entrega al-menos-una-vez: reprocesar el mismo evento (DONE → PENDING) no duplica solicitud ni vínculo", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202); await drain([id]);
    expect(await solicitudes(id)).toBe(1); expect((await outbox(id))[0].status).toBe("DONE");
    for (let i = 0; i < 3; i++) { await ctx.db.query("UPDATE ps_api01_outbox SET status='PENDING', next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?)", [await hex(id)]); await drain([id]); }
    expect(await solicitudes(id)).toBe(1); expect(await ctx.count("SELECT COUNT(*) n FROM ps_api12_tms_links WHERE order_id = UNHEX(?)", [await hex(id)])).toBe(1);
  });

  it("F4 caída del procesador: un evento reclamado y abandonado (lease) lo recupera otro despachador tras el vencimiento, sin duplicar", async () => {
    const id = uid(); await withoutMapping("a", async () => { expect((await post("a", id)).status).toBe(202); });   // fast-path sin mapeo → trabajo PENDING; mapeo ya restaurado
    await dueNow(id);
    const claimed = await workerStore().claim(100, 1000); expect(claimed.length).toBeGreaterThan(0);   // «proceso caído»: reclama y no cierra nunca
    const mine = (await outbox(id))[0]; expect(["LEASED", "DONE"]).toContain(mine.status);
    await new Promise((r) => setTimeout(r, 1300));   // vence la lease (reloj de la base)
    await drain([id]); expect((await outbox(id))[0].status).toBe("DONE"); expect(await solicitudes(id)).toBe(1);
    expect(Number((await outbox(id))[0].attempts)).toBeGreaterThanOrEqual(2);   // el segundo intento lo hizo otro despachador
    // Fencing: el proceso «caído» que reclamó antes ya no puede cerrar ese evento.
    const myHex = String(await hex(id)); const old = claimed.find((c) => c.event.orderId.replaceAll("-", "").toUpperCase() === myHex); if (old) expect(await workerStore().complete(old)).toBe(false);
  });

  it("F5 concurrencia: dos despachadores a la vez sobre 6 órdenes pendientes → cada orden queda con EXACTAMENTE una solicitud y su outbox DONE", async () => {
    const ids = Array.from({ length: 6 }, () => uid());
    await withoutMapping("a", async () => { for (const id of ids) expect((await post("a", id)).status).toBe(202); });
    for (const id of ids) await dueNow(id);
    await Promise.all([drain(ids, dispatcher()), drain(ids, dispatcher()), drain(ids, dispatcher())]);
    for (const id of ids) { expect(await solicitudes(id), id).toBe(1); expect((await outbox(id))[0].status, id).toBe("DONE"); }
  });

  it("F6 reintentos agotados → REVIEW durable (no se descarta ni se marca DONE) y un evento en REVIEW no vuelve a procesarse solo", async () => {
    const id = uid(); const d = dispatcher({ ...POLICY, maxAttempts: 2 });
    await withoutMapping("a", async () => {
      expect((await post("a", id)).status).toBe(202);
      for (let i = 0; i < 3; i++) { await dueNow(id); await d.runOnce(); }
    });
    const ob = await outbox(id); expect(ob[0].status).toBe("REVIEW"); expect(await solicitudes(id)).toBe(0);
    await d.runOnce(); await d.runOnce(); expect((await outbox(id))[0].status).toBe("REVIEW");   // sigue en revisión humana aunque el TMS ya esté disponible
    expect(log.some((l) => l.outcome === "REVIEW" && l.code === "MAX_ATTEMPTS")).toBe(true);
  });

  it("F7 cancelación: se recibe, se persiste (evento v2), y su procesamiento deja UNA constancia en el vínculo y en la auditoría — sin cancelar solicitud, plan ni viaje — aunque se reprocese", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202); await drain([id]); expect(await solicitudes(id)).toBe(1);
    const planesAntes = await planes(); const [antes] = await ctx.rows("SELECT estado FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, id]);
    const c = await cancel("a", id); expect(c.status).toBe(202);
    expect((await outbox(id)).map((o) => o.v)).toEqual([1, 2]);
    for (let i = 0; i < 3; i++) { await ctx.db.query("UPDATE ps_api01_outbox SET status='PENDING', next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND order_version = 2", [await hex(id)]); await drain([id]); }
    expect((await outbox(id)).every((o) => o.status === "DONE")).toBe(true);
    expect(await ctx.count("SELECT COUNT(*) n FROM auditoria WHERE accion = 'pricesmart_cancelacion_solicitada' AND detalle LIKE ?", [`%${id}%`])).toBe(1);   // idempotente: un solo registro
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api12_tms_links WHERE order_id = UNHEX(?) AND cancellation_requested_at IS NOT NULL", [await hex(id)])).toBe(1);
    const [despues] = await ctx.rows("SELECT estado FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, id]);
    expect(despues.estado).toBe(antes.estado); expect(await planes()).toBe(planesAntes);   // Operaciones decide: nada se cancela solo
    const st = await get("a", id); expect(st.json).toMatchObject({ confirmsDelivery: false }); expect((await cancel("a", id, "DUPLICATE")).status).toBe(409);
  });

  /** Deja una orden VINCULADA y con su solicitud de cancelación recibida, pero SIN constancia (estado previo a procesar la cancelación): el evento v2 queda PENDING. Solo laboratorio desechable. */
  async function linkedWithPendingCancellation() {
    const id = uid(); expect((await post("a", id)).status).toBe(202); await drain([id]); expect(await solicitudes(id)).toBe(1);
    expect((await cancel("a", id)).status).toBe(202);   // la vía rápida de la app ya pudo dejar constancia: se retira para reproducir el estado previo al procesamiento
    const h = await hex(id);
    await ctx.db.query("UPDATE ps_api12_tms_links SET cancellation_requested_at = NULL WHERE order_id = UNHEX(?)", [h]);
    await ctx.db.query("DELETE FROM auditoria WHERE accion = 'pricesmart_cancelacion_solicitada' AND detalle LIKE ?", [`%${id}%`]);
    await ctx.db.query("UPDATE ps_api01_outbox SET status='PENDING', attempts=0, next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND order_version = 2", [h]);
    return { id, h };
  }
  const auditCount = (id: string) => ctx.count("SELECT COUNT(*) n FROM auditoria WHERE accion = 'pricesmart_cancelacion_solicitada' AND detalle LIKE ?", [`%${id}%`]);
  const constancias = (h: string) => ctx.count("SELECT COUNT(*) n FROM ps_api12_tms_links WHERE order_id = UNHEX(?) AND cancellation_requested_at IS NOT NULL", [h]);

  it("F7b la auditoría de la cancelación FALLA tras actualizar el vínculo → todo se revierte, la outbox NO marca DONE, reintenta, se recupera la constancia y la auditoría queda con EXACTAMENTE un registro", async () => {
    const { id, h } = await linkedWithPendingCancellation();
    const pool = getPool(); const repository = mariaDbOrderRepository(pool, { schema, runtimeUser: String(process.env.DB_USER), cipher: labCipher(labKey), contract: labContract });
    let fails = 2;   // la auditoría falla en los dos primeros intentos (después de que el UPDATE del vínculo ya se ejecutó dentro de la transacción)
    const failing = createTmsLinker({ pool, schema, repository, auditTx: async (conn, input) => { if (fails-- > 0) throw new Error("auditoría caída"); const { registrarAuditoriaTx } = await import("@/lib/auditoria"); await registrarAuditoriaTx(conn, input); } });
    const flaky = createLinkOutboxHandler({ pool, schema, retry, linker: failing });
    const d = dispatcher(POLICY, workerStore(), flaky);
    for (let i = 0; i < 2; i++) {
      await ctx.db.query("UPDATE ps_api01_outbox SET next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND order_version = 2", [h]);
      const r = await d.runOnce(); expect(r.done).toBe(0); expect(r.retried).toBeGreaterThanOrEqual(1);
      expect(await constancias(h)).toBe(0); expect(await auditCount(id)).toBe(0);   // revertido: ni constancia sin auditoría ni auditoría sin constancia
      expect((await outbox(id)).find((o) => o.v === 2)!.status).toBe("PENDING");   // NO DONE mientras falte la constancia obligatoria
    }
    await ctx.db.query("UPDATE ps_api01_outbox SET next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND order_version = 2", [h]);
    await d.runOnce();   // la auditoría ya funciona → recupera la constancia
    expect((await outbox(id)).find((o) => o.v === 2)!.status).toBe("DONE"); expect(await constancias(h)).toBe(1); expect(await auditCount(id)).toBe(1);
    for (let i = 0; i < 2; i++) { await ctx.db.query("UPDATE ps_api01_outbox SET status='PENDING', next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND order_version = 2", [h]); await d.runOnce(); }
    expect(await auditCount(id)).toBe(1);   // reprocesar no duplica
    const [sol] = await ctx.rows("SELECT estado, plan_id FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, id]); expect(sol).toMatchObject({ estado: "SOLICITADA", plan_id: null });   // nada se cancela solo
  });

  it("F7c concurrencia: 4 llamadas simultáneas a noteCancellation + 2 despachadores sobre la misma cancelación → UNA constancia y UN registro de auditoría", async () => {
    const { id, h } = await linkedWithPendingCancellation();
    const res = await Promise.allSettled([...Array.from({ length: 4 }, () => linker.noteCancellation(scopeFull("a"), id)), drain([id], dispatcher()), drain([id], dispatcher())]);
    expect(res.filter((r) => r.status === "rejected").map((r) => { const e = (r as PromiseRejectedResult).reason as { code?: string; sql?: string }; return `${e.code} ${String(e.sql).slice(0, 90)}`; })).toEqual([]);
    expect(await constancias(h)).toBe(1); expect(await auditCount(id)).toBe(1); expect((await outbox(id)).every((o) => o.status === "DONE")).toBe(true);
  });

  it("F8 estado incompatible: cancelar ANTES de vincular → la orden jamás se vincula al TMS (ni por la outbox ni por el trabajador) y nada queda colgado", async () => {
    const id = uid();
    await withoutMapping("a", async (restore) => {
      expect((await post("a", id)).status).toBe(202); expect((await cancel("a", id)).status).toBe(202);
      await restore(); await dueNow(id);
      await drain([id]);
    });
    await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE order_id = UNHEX(?) AND status = 'PENDING'", [await hex(id)]); await retry.runOnce("t-f8");
    expect(await solicitudes(id)).toBe(0);
    expect((await outbox(id)).every((o) => o.status === "DONE" || o.status === "PENDING")).toBe(true);
    const [job] = await ctx.rows("SELECT status, last_outcome FROM ps_api13_link_jobs WHERE order_id = UNHEX(?)", [await hex(id)]); expect(["BLOCKED", "DONE"]).toContain(job.status);
  });

  it("F9 aislamiento: la misma referencia en otra empresa es otra orden con su propia solicitud; un evento no se procesa en el alcance de otro; no hay mezcla de empresas", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202); expect((await post("b", id)).status).toBe(202); await drain([id]);
    expect(await solicitudes(id, empresas.a.empresaId)).toBe(1); expect(await solicitudes(id, empresas.b.empresaId)).toBe(1);
    expect((await get("b", id)).json.tms.linked).toBe(true); expect((await cancel("b", "NO-EXISTE")).status).toBe(404);
    // Un evento cuyo alcance (otro tenant) no contiene la orden → REVIEW, nunca se procesa.
    const oid = await hex(id); const uuid = `${oid.slice(0, 8)}-${oid.slice(8, 12)}-${oid.slice(12, 16)}-${oid.slice(16, 20)}-${oid.slice(20)}`.toLowerCase();
    const foreign = { scope: { environment: "sandbox" as const, tenantId: empresas.b.empresaId + 999, clientId: 1, integrationId: "pricesmart-lab", originClubReference: "QA-CLUB" }, orderId: uuid, version: 1, type: "RECEIVED" as const, reason: null, correlationId: uuid };
    expect(await handler.handle(foreign)).toEqual({ kind: "REVIEW", reason: "ORDER_NOT_IN_SCOPE" });
  });

  it("F10 seguridad M2M adversaria sobre el flujo: evidencia caducada / emitida en el futuro / de otro entorno / sin evidencia / manipulada / revocada / desconocida → rechazo, y NADA se persiste", async () => {
    const id = uid(); const now = Date.now(); const antes = await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders");
    expect((await post("a", id, labOrder(id), { issuedAtMs: now - 3600_000, expiresAtMs: now - 3000_000 })).status).toBeOneOf([401, 403]);   // caducada
    expect((await post("a", id, labOrder(id), { issuedAtMs: now + 3600_000, expiresAtMs: now + 3660_000 })).status).toBeOneOf([401, 403]);   // emitida en el futuro
    expect((await post("a", id, labOrder(id), { issuedAtMs: now, expiresAtMs: now - 1 })).status).toBeOneOf([401, 403]);   // vence antes de emitirse
    expect((await post("a", id, labOrder(id), { environment: "production" })).status).toBeOneOf([401, 403]);   // prueba ligada al entorno production: la credencial de laboratorio no vale allí
    for (const k of [null, "rev", "ghost"] as const) expect((await post(k, id)).status, String(k)).toBe(401);
    expect((await post("a", id, labOrder(id), { tamper: true })).status).toBe(401);
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders")).toBe(antes);
    // La prueba de solicitud está ligada al cuerpo: cambiar el cuerpo tras firmar → rechazo.
    const signed = await call("POST", API, "orders:create", "a", id, labOrder(id)); expect(signed.status).toBe(202);
    const other = uid(); const swapped = await call("POST", API, "orders:create", "a", other, labOrder(id, { address: "Otra dirección ficticia 77" })); expect([400, 401, 403]).toContain(swapped.status);
    // Replay de una prueba ya usada → 409.
    const pid = `rp${uid()}`;
    const r1 = uid(); expect((await post("a", r1, labOrder(r1), { proofId: pid })).status).toBe(202);
    const r2 = await post("a", r1, labOrder(r1), { proofId: pid }); expect(r2.status).toBe(409); expect(r2.json.code).toBe("REPLAY_REJECTED");
  });

  it("F11 permisos/alcance: una credencial solo con `orders:read` no puede crear ni cancelar, y la revocada no hace nada (catálogo real en MariaDB)", async () => {
    const A = empresas.a.empresaId; const FROM = 1700000000000; const FAR = 4102444800000;
    await ctx.db.query("INSERT IGNORE INTO ps_api11_integrations (issuer, subject, credential_reference, environment, tenant_id, client_id, integration_id, revision, status, valid_from_ms, valid_until_ms, credential_valid_from_ms, credential_valid_until_ms, rotated_at_ms, allowed_clubs_json, scopes_json) VALUES (?, ?, ?, _binary'sandbox', ?, 1, ?, 1, 'ACTIVE', ?, ?, ?, ?, ?, ?, ?)",
      [Buffer.from("lab-issuer"), Buffer.from("lab-subject-ro"), Buffer.from("lab-cred-ro-1"), A, Buffer.from("pricesmart-lab"), FROM, FAR, FROM, FAR, FROM, JSON.stringify(["QA-CLUB"]), JSON.stringify(["orders:read"])]);
    const id = uid(); const id2 = uid(); expect((await post("a", id)).status).toBe(202);
    const ro = await call("POST", API, "orders:create", "ro" as Key, id2, labOrder(id2)); expect([401, 403]).toContain(ro.status);
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [A, Buffer.from(id2)])).toBe(0);
    expect([401, 403]).toContain((await cancel("ro" as Key, id)).status);
    expect((await get("a", id)).json.provisionalStatus).toBe("RECEIVED");   // la orden sigue intacta
  });

  it("F12 los extremos del flujo siguen cerrados: GET sin evidencia → 401, orden inexistente → 404, y la respuesta nunca contiene datos de otra empresa", async () => {
    expect((await get(null, "X")).status).toBe(401); const nf = await get("a", "NO-EXISTE-23"); expect(nf.status).toBe(404); expect(Object.keys(nf.json).sort()).toEqual(["code", "correlationId"]);
  });
});

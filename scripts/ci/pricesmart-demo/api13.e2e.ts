// PRICESMART-API-13 — resiliencia operativa y trazabilidad, contra la app real (`next dev`) y MariaDB 11.8.9 real, desechable, con datos ficticios.
// Reintentos de vinculación (caídas antes/después, recuperación sin reenvío, reinicio, trabajadores concurrentes, colisiones, límites) y visibilidad para Operaciones.
// El «trabajador» se ejecuta en el proceso de la prueba con las mismas funciones que usa la app (createLinkRetry); el trabajador DENTRO de la app se prueba en api13-worker.e2e.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "@/lib/db";
import { crearSolicitudCliente } from "@/lib/tms/solicitudes-cliente";
import { mariaDbOrderRepository } from "../../../src/lib/integrations/pricesmart/mariadb-repository";
import { labContract } from "../../../src/lib/integrations/pricesmart/lab-demo/contract";
import { labCipher } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-crypto";
import { createTmsLinker, claimMarker } from "../../../src/lib/integrations/pricesmart/lab-demo/tms-link";
import { createLinkRetry, type RetryPolicy } from "../../../src/lib/integrations/pricesmart/lab-demo/link-retry";
import { INTEGRATION, API, BASE, cancel, connect, empresas, get, labKey, labOrder, post, scopeFull, uid, type Key, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  ctx = await connect();
  // Aísla esta prueba de trabajos pendientes de otras pruebas: los aplaza un día (la app usa su retroceso normal de 30 s).
  await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY) WHERE status = 'PENDING'");
});
afterAll(async () => { await ctx.db.end(); });
const rows: typeof ctx.rows = (...a) => ctx.rows(...a);
const count: typeof ctx.count = (...a) => ctx.count(...a);

// ---- trabajador en proceso (mismas funciones que la app)
const schema = String(process.env.DB_NAME); const pool = getPool();
const repository = mariaDbOrderRepository(pool, { schema, runtimeUser: String(process.env.DB_USER), cipher: labCipher(labKey), contract: labContract });
const worker = (createRequest?: typeof crearSolicitudCliente, policy: Partial<RetryPolicy> = {}) =>
  createLinkRetry({ pool, schema, linker: createTmsLinker({ pool, schema, repository, createRequest }), policy: { baseDelayMs: 0, maxAttempts: 3, leaseMs: 60000, ...policy } });
const dueAll = () => ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING' AND lease_until IS NULL AND external_order_id LIKE 'PS%'");
const due = (id: string) => ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE external_order_id = ? AND status = 'PENDING'", [Buffer.from(id)]);
const jobsOf = (id: string) => rows("SELECT tenant_id, client_id, status, attempts, last_outcome, last_detail, empresa_id, ack_by, HEX(order_id) AS oid FROM ps_api13_link_jobs WHERE external_order_id = ? ORDER BY tenant_id, client_id", [Buffer.from(id)]);
const attemptsOf = (id: string, tenant = empresas.a.empresaId, client = 1) => rows("SELECT attempt_no, worker_id, outcome, detail, finished_at FROM ps_api13_link_attempts WHERE tenant_id = ? AND client_id = ? AND order_id = (SELECT order_id FROM ps_api13_link_jobs WHERE tenant_id = ? AND client_id = ? AND external_order_id = ?) ORDER BY attempt_no", [tenant, client, tenant, client, Buffer.from(id)]);
const solicitudes = (id: string, empresaId = empresas.a.empresaId) => rows("SELECT id, estado, plan_id, observaciones FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ? ORDER BY id", [empresaId, id]);
const linkOf = (id: string, key: Key) => rows("SELECT claim_token, solicitud_id, empresa_id FROM ps_api12_tms_links l JOIN ps_api01_orders o ON o.environment = l.environment AND o.tenant_id = l.tenant_id AND o.client_id = l.client_id AND o.integration_id = l.integration_id AND o.id = l.order_id WHERE l.tenant_id = ? AND l.client_id = ? AND o.external_order_id = ?", [scopeFull(key).tenantId, scopeFull(key).clientId, Buffer.from(id)]);

/** Recibe órdenes SIN vinculación inmediata: quita el mapeo administrativo mientras se hace el POST y lo restaura. La orden queda guardada y el trabajo encolado (UNMAPPED). */
async function withoutMapping<T>(keys: Key[], fn: () => Promise<T>): Promise<T> {
  const saved: Row[] = [];
  for (const k of keys) { const s = scopeFull(k); const r = await rows("SELECT * FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]); saved.push(...r); await ctx.db.query("DELETE FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]); }
  try { return await fn(); } finally {
    for (const m of saved) await ctx.db.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (?,?,?,?,?,?,?,?,?)",
      [m.environment, m.tenant_id, m.client_id, m.integration_id, m.empresa_id, m.tms_cliente_id, m.tms_usuario_cliente_id, m.pickup_place, m.dropoff_place]);
  }
}
/** Resultados de un ciclo que corresponden a UNA orden (el trabajador procesa todo lo vencido; otras órdenes de la misma prueba no deben alterar la comprobación). */
const mine = (results: Row[], id: string) => results.filter((r) => r.externalOrderId === id);
const unlinked = async (key: Key, id: string) => { const r = await withoutMapping([key], () => post(key, id)); expect(r.status).toBe(202); };
const opsApi = async (slug = empresas.a.slug, suffix = "") => { const r = await fetch(`${BASE}/api/empresas/${slug}/tms/solicitudes-clientes/pricesmart${suffix}`, { headers: { cookie: ctx.cookie } }); return { status: r.status, json: (await r.json()) as Row }; };
const opsAck = async (slug: string, id: string) => { const r = await fetch(`${BASE}/api/empresas/${slug}/tms/solicitudes-clientes/pricesmart/reconocer`, { method: "POST", headers: { cookie: ctx.cookie, "content-type": "application/json" }, body: JSON.stringify({ id }) }); return r.status; };

describe("API-13 reintentos de vinculación y trazabilidad", () => {
  it("API13.1 POST exitoso: vínculo TMS inmediato, trabajo DONE y primer intento registrado", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    expect(await solicitudes(id)).toHaveLength(1); expect((await get("a", id)).json.tms).toMatchObject({ linked: true, requestState: "SOLICITADA" });
    expect((await jobsOf(id))[0]).toMatchObject({ status: "DONE", attempts: 1, last_outcome: "LINKED" });
    expect(await attemptsOf(id)).toMatchObject([{ attempt_no: 1, worker_id: "inline", outcome: "LINKED" }]);
  });

  it("API13.2 caída ANTES de crear la solicitud: queda registrado, no hay solicitud y el siguiente ciclo la vincula SIN reenvío", async () => {
    const id = uid(); await unlinked("d", id); await due(id);
    const antes = (async () => { throw new Error("caída simulada ANTES de crear con detalle-secreto-xyz"); }) as unknown as typeof crearSolicitudCliente;
    expect(mine(await worker(antes).runOnce("w-caida"), id)).toMatchObject([{ externalOrderId: id, outcome: "ERROR", status: "PENDING" }]);
    expect(await solicitudes(id)).toHaveLength(0);
    const log = await attemptsOf(id, empresas.a.empresaId, 3); expect(log.at(-1)).toMatchObject({ outcome: "ERROR", worker_id: "w-caida" }); expect(JSON.stringify(log)).not.toContain("detalle-secreto-xyz");   // solo un código, no el mensaje crudo
    await due(id); expect(mine(await worker().runOnce("w-ok"), id)).toMatchObject([{ outcome: "LINKED", status: "DONE" }]);
    expect(await solicitudes(id)).toHaveLength(1); expect((await jobsOf(id))[0]).toMatchObject({ status: "DONE", attempts: 3 });
  });

  it("API13.3 caída DESPUÉS de crear la solicitud: el vínculo ya es atómico (sin ventana), el reintento no duplica", async () => {
    const id = uid(); await unlinked("d", id); await due(id);
    const despues = (async (s: Parameters<typeof crearSolicitudCliente>[0], i: Parameters<typeof crearSolicitudCliente>[1], g: Parameters<typeof crearSolicitudCliente>[2]) => { await crearSolicitudCliente(s, i, g); throw new Error("caída simulada DESPUÉS de crear"); }) as typeof crearSolicitudCliente;
    expect(mine(await worker(despues).runOnce("w-caida"), id)).toMatchObject([{ outcome: "ERROR", status: "PENDING" }]);
    expect(await solicitudes(id)).toHaveLength(1); const [l] = await linkOf(id, "d"); expect(l.solicitud_id).not.toBeNull();   // vínculo completo pese a la caída
    expect((await get("d", id)).json.tms.linked).toBe(true);
    await due(id); expect(mine(await worker().runOnce("w-ok"), id)).toMatchObject([{ outcome: "ALREADY_LINKED", status: "DONE" }]);
    expect(await solicitudes(id)).toHaveLength(1);
  });

  it("API13.4 recuperación SIN que PriceSmart reenvíe: nadie vuelve a hacer POST y la orden queda vinculada", async () => {
    const id = uid(); await unlinked("d", id); await due(id);
    const antesEventos = await count("SELECT COUNT(*) n FROM ps_api01_events e JOIN ps_api01_orders o ON o.id = e.order_id WHERE o.external_order_id = ?", [Buffer.from(id)]);
    expect(mine(await worker().runOnce("w-recupera"), id)).toMatchObject([{ outcome: "LINKED" }]);
    expect(await solicitudes(id)).toHaveLength(1);
    expect(await count("SELECT COUNT(*) n FROM ps_api01_events e JOIN ps_api01_orders o ON o.id = e.order_id WHERE o.external_order_id = ?", [Buffer.from(id)])).toBe(antesEventos);   // ningún POST adicional
  });

  it("API13.5 recuperación tras reinicio: un trabajador muerto con lease vigente bloquea; al vencer el lease otro lo toma", async () => {
    const id = uid(); await unlinked("d", id); await due(id);
    const muerto = await worker().claim(1, { scope: scopeFull("d"), externalOrderId: id });   // reclama y «se cae»: nunca procesa ni cierra
    expect(muerto).toHaveLength(1);
    expect(await worker().claim(1, { scope: scopeFull("d"), externalOrderId: id })).toHaveLength(0);   // lease vigente: nadie más lo toma
    await ctx.db.query("UPDATE ps_api13_link_jobs SET lease_until = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE external_order_id = ?", [Buffer.from(id)]);   // el lease vence
    expect(mine(await worker().runOnce("w-nuevo"), id)).toMatchObject([{ outcome: "LINKED", status: "DONE" }]);
    expect(await solicitudes(id)).toHaveLength(1); expect((await jobsOf(id))[0]).toMatchObject({ status: "DONE", attempts: 3 });
    // el trabajador muerto, si «despertara», no podría cerrar el trabajo (fencing): ya está DONE y su lease no coincide
    const [fin] = await ctx.db.query("UPDATE ps_api13_link_jobs SET status = 'PENDING' WHERE external_order_id = ? AND lease_owner = ?", [Buffer.from(id), muerto[0].lease]) as unknown as [{ affectedRows: number }];
    expect(fin.affectedRows).toBe(0);
  });

  it("API13.6 tres trabajadores concurrentes sobre 6 órdenes pendientes: cada orden queda con UNA solicitud, ningún lease perdido y todos los intentos registrados", async () => {
    const ids = Array.from({ length: 6 }, () => uid());
    for (const id of ids) await unlinked("d", id);
    await dueAll(); const w = [worker(), worker(), worker()]; const results: Row[] = [];
    for (let round = 0; round < 6; round++) {
      results.push(...(await Promise.all(w.map((x, i) => x.runOnce(`w${i + 1}`, 2)))).flat());
      if ((await count(`SELECT COUNT(*) n FROM ps_api13_link_jobs WHERE status = 'DONE' AND external_order_id IN (${ids.map(() => "?").join(",")})`, ids.map((i) => Buffer.from(i)))) === ids.length) break;
      await dueAll();
    }
    for (const id of ids) { expect(await solicitudes(id), id).toHaveLength(1); expect((await jobsOf(id))[0].status).toBe("DONE"); const nos = (await attemptsOf(id, empresas.a.empresaId, 3)).map((a) => a.attempt_no); expect(new Set(nos).size).toBe(nos.length); }
    expect(results.filter((r) => r.status === "LEASE_LOST")).toHaveLength(0);
    expect(results.filter((r) => r.outcome === "LINKED")).toHaveLength(ids.length);   // cada orden se vinculó exactamente una vez
  });

  it("API13.7 colisión de referencias entre integraciones (mismo cliente y usuario de servicio) y entre empresas: cada orden, su solicitud y su empresa", async () => {
    const x = uid();
    await withoutMapping(["a", "c", "d", "b"], async () => { for (const k of ["a", "c", "d", "b"] as Key[]) expect((await post(k, x)).status).toBe(202); });
    await dueAll(); const w = [worker(), worker()];
    for (let round = 0; round < 4; round++) { await Promise.all(w.map((q, i) => q.runOnce(`c${i}`, 5))); await dueAll(); }
    expect(await solicitudes(x, empresas.a.empresaId)).toHaveLength(3); expect(await solicitudes(x, empresas.b.empresaId)).toHaveLength(1);
    const links = new Map<Key, Row>(); for (const k of ["a", "c", "d", "b"] as Key[]) { const [l] = await linkOf(x, k); links.set(k, l); }
    expect(new Set([...links.values()].map((l) => l.solicitud_id)).size).toBe(4);
    for (const k of ["a", "c", "d"] as Key[]) { const l = links.get(k)!; expect(l.empresa_id).toBe(empresas.a.empresaId); expect(String((await solicitudes(x)).find((s) => s.id === l.solicitud_id)!.observaciones).startsWith(claimMarker(l.claim_token))).toBe(true); }
    expect(links.get("b")!.empresa_id).toBe(empresas.b.empresaId); expect((await solicitudes(x, empresas.b.empresaId))[0].id).toBe(links.get("b")!.solicitud_id);
    expect((await jobsOf(x)).map((j) => j.status)).toEqual(["DONE", "DONE", "DONE", "DONE"]);
  });

  let blockedRef = ""; let exhaustedRef = "";
  it("API13.8 límites: rechazo del TMS → BLOQUEADA sin reintentos; sin mapeo persistente → tras 3 intentos AGOTADA y no se reclama más", async () => {
    blockedRef = uid(); expect((await post("a", blockedRef, labOrder(blockedRef, { deliveryDate: "2020-01-01" }))).status).toBe(202);
    expect((await jobsOf(blockedRef))[0]).toMatchObject({ status: "BLOCKED", attempts: 1, last_outcome: "REJECTED_BY_TMS" }); await dueAll(); expect(mine(await worker().runOnce("w-x"), blockedRef)).toEqual([]);
    exhaustedRef = uid();
    await withoutMapping(["d"], async () => {
      expect((await post("d", exhaustedRef)).status).toBe(202);   // intento 1 (inline) → UNMAPPED
      for (let i = 0; i < 2; i++) { await due(exhaustedRef); expect(mine(await worker().runOnce("w-x"), exhaustedRef)).toHaveLength(1); }   // intentos 2 y 3
      await due(exhaustedRef); expect(mine(await worker().runOnce("w-x"), exhaustedRef)).toEqual([]);   // agotado: no se reclama
    });
    expect((await jobsOf(exhaustedRef))[0]).toMatchObject({ status: "EXHAUSTED", attempts: 3, last_outcome: "UNMAPPED" }); expect(await attemptsOf(exhaustedRef, empresas.a.empresaId, 3)).toHaveLength(3);
    expect(await solicitudes(exhaustedRef)).toHaveLength(0);
  });

  it("API13.9 Operaciones ve las vinculaciones fallidas/pendientes sin información sensible y puede reconocerlas (solo constancia); otra empresa no las ve ni las reconoce", async () => {
    const lista = await opsApi(); expect(lista.status).toBe(200); expect(lista.json.enabled).toBe(true);
    const bloqueada = (lista.json.pendientes as Row[]).find((p) => p.referencia === blockedRef)!; const agotada = (lista.json.pendientes as Row[]).find((p) => p.referencia === exhaustedRef);
    expect(bloqueada).toMatchObject({ estado: "BLOQUEADA", intentos: 1, ultimoResultado: "REJECTED_BY_TMS", reconocidoPor: null });
    expect(agotada).toBeUndefined();   // el trabajo AGOTADA de la integración «d» sin mapeo no tiene empresa conocida: no se muestra a ninguna empresa (límite documentado)
    const texto = JSON.stringify(lista.json); expect(texto).not.toMatch(/claim|token|\[PS:|x-lab-evidence/i); expect(texto).not.toContain(labKey);
    expect((await opsApi(empresas.b.slug)).json.pendientes.some((p: Row) => p.referencia === blockedRef)).toBe(false);
    expect(await opsAck(empresas.b.slug, bloqueada.id)).toBe(404);   // otra empresa no puede reconocerla
    const solsAntes = await count("SELECT COUNT(*) n FROM tms_solicitudes_cliente"); const planesAntes = await count("SELECT COUNT(*) n FROM tms_planes_viaje");
    expect(await opsAck(empresas.a.slug, bloqueada.id)).toBe(200); expect(await opsAck(empresas.a.slug, bloqueada.id)).toBe(404);
    expect(await opsAck(empresas.a.slug, "zz")).toBe(400);
    expect(((await opsApi()).json.pendientes as Row[]).find((p) => p.referencia === blockedRef)).toMatchObject({ reconocidoPor: "ops.lab" });
    expect(await count("SELECT COUNT(*) n FROM tms_solicitudes_cliente")).toBe(solsAntes); expect(await count("SELECT COUNT(*) n FROM tms_planes_viaje")).toBe(planesAntes);   // reconocer no crea ni cambia nada del TMS
    expect(await count("SELECT COUNT(*) n FROM auditoria WHERE empresa_id = ? AND accion = 'pricesmart_vinculacion_reconocida'", [empresas.a.empresaId])).toBeGreaterThanOrEqual(1);
  });

  it("API13.10 la solicitud originada por PriceSmart se identifica en la bandeja y su cancelación pedida es visible mientras esté pendiente; no se cancela ningún plan", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    const [sol] = await solicitudes(id); const antes = await opsApi();
    expect((antes.json.origen as Row[]).find((o) => o.solicitudId === sol.id)).toMatchObject({ cancelacionPendiente: false, cancelacionSolicitadaEn: null });
    expect((await cancel("a", id)).status).toBe(202);
    const despues = await opsApi(); expect((despues.json.origen as Row[]).find((o) => o.solicitudId === sol.id)).toMatchObject({ cancelacionPendiente: true });
    expect((await solicitudes(id))[0]).toMatchObject({ estado: "SOLICITADA", plan_id: null });   // nada se canceló solo
    const r = await fetch(`${BASE}/api/empresas/${empresas.a.slug}/tms/solicitudes-clientes/${sol.id}`, { method: "PATCH", headers: { cookie: ctx.cookie, "content-type": "application/json" }, body: JSON.stringify({ accion: "rechazar", version: (await rows("SELECT version FROM tms_solicitudes_cliente WHERE id = ?", [sol.id]))[0].version, motivo: "Cancelación solicitada por PriceSmart (laboratorio)" }) });
    expect(r.status).toBe(200);   // decisión HUMANA de Operaciones
    expect(((await opsApi()).json.origen as Row[]).find((o) => o.solicitudId === sol.id)).toMatchObject({ cancelacionPendiente: false });
    const page = await fetch(`${BASE}/e/${empresas.a.slug}/tms/solicitudes-clientes`, { headers: { cookie: ctx.cookie } }); expect(page.status).toBe(200);
  });

  it("API13.11 barrido: una orden guardada cuyo trabajo nunca se encoló (caída tras el commit) se descubre y se vincula sola", async () => {
    const id = uid(); await unlinked("d", id);
    await ctx.db.query("DELETE FROM ps_api13_link_attempts WHERE order_id = (SELECT order_id FROM ps_api13_link_jobs WHERE external_order_id = ?)", [Buffer.from(id)]);
    await ctx.db.query("DELETE FROM ps_api13_link_jobs WHERE external_order_id = ?", [Buffer.from(id)]);   // simula la caída entre el commit de la orden y el encolado
    expect(await jobsOf(id)).toHaveLength(0);
    expect(mine(await worker().runOnce("w-barrido"), id)).toMatchObject([{ externalOrderId: id, outcome: "LINKED" }]); expect(await solicitudes(id)).toHaveLength(1);
  });

  it("API13.12 una orden cancelada antes de vincularse NO genera solicitud: el trabajo pasa a BLOQUEADA (ORDER_NOT_ELIGIBLE)", async () => {
    const id = uid(); await unlinked("d", id); expect((await cancel("d", id)).status).toBe(202); await due(id);
    expect(mine(await worker().runOnce("w-x"), id)).toMatchObject([{ outcome: "ORDER_NOT_ELIGIBLE", status: "BLOCKED" }]); expect(await solicitudes(id)).toHaveLength(0);
  });

  it("API13.13 el contrato de la API no cambia: las rutas siguen exigiendo autenticación y el GET no declara entrega", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    expect((await fetch(`${API}/${id}`)).status).toBe(401); const g = await get("a", id); expect(g.json.confirmsDelivery).toBe(false); expect(JSON.stringify(g.json)).not.toMatch(/DELIVERED|ENTREGAD/i);
    expect(INTEGRATION).toBe("pricesmart-lab");
  });
});

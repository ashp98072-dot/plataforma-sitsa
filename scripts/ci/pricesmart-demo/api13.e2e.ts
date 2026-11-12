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
const ORDER_OF = "(SELECT order_id FROM ps_api13_link_jobs WHERE tenant_id = ? AND client_id = ? AND external_order_id = ?)";
/** Todos los eventos inmutables del registro de intentos (STARTED/FINISHED), en orden. */
const eventsOf = (id: string, tenant = empresas.a.empresaId, client = 1) => rows(`SELECT id, attempt_no, event, worker_id, outcome, detail, recorded_at FROM ps_api13_link_attempts WHERE tenant_id = ? AND client_id = ? AND order_id = ${ORDER_OF} ORDER BY attempt_no, event DESC`, [tenant, client, tenant, client, Buffer.from(id)]);
/** Solo los eventos FINISHED (un resultado por intento terminado). */
const attemptsOf = async (id: string, tenant = empresas.a.empresaId, client = 1) => (await eventsOf(id, tenant, client)).filter((e) => e.event === "FINISHED");
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
    expect((await eventsOf(id)).map((e) => `${e.attempt_no}:${e.event}`)).toEqual(["1:STARTED", "1:FINISHED"]);   // dos eventos inmutables por intento
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

  // ---- Leases vencidos con un trabajador que SIGUE ejecutándose (auditoría de #604)
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };
  /** Mismo contenido de una fila del registro de eventos, para demostrar que no se modifica nunca. */
  const snapshot = (r: Row) => JSON.stringify([r.id, r.attempt_no, r.event, r.worker_id, r.outcome, r.detail, String(r.recorded_at)]);

  it("API13.14 lease vencido con el primer trabajador aún ejecutándose DENTRO de la creación: el segundo reclama, espera el bloqueo, y al terminar el primero queda UNA solicitud, UN vínculo, fencing correcto y registro consistente; sin fuga entre empresas", async () => {
    const idA = uid(); const idB = uid();
    await unlinked("d", idA); await unlinked("b", idB);   // dos empresas distintas, ambas guardadas y sin vincular
    const entered = deferred(); const gate = deferred();
    const slow = (async (sc: Parameters<typeof crearSolicitudCliente>[0], inp: Parameters<typeof crearSolicitudCliente>[1], g: Parameters<typeof crearSolicitudCliente>[2]) => { entered.resolve(); await gate.promise; return crearSolicitudCliente(sc, inp, g); }) as typeof crearSolicitudCliente;
    await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 10 SECOND) WHERE external_order_id = ?", [Buffer.from(idA)]);
    await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 5 SECOND) WHERE external_order_id = ?", [Buffer.from(idB)]);
    // Trabajador 1: reclama SOLO la orden A (la más antigua) y se queda dentro de la creación, sosteniendo el bloqueo de la orden.
    const w1 = worker(slow, { maxAttempts: 6 }).runOnce("w1-lento", 1);
    await entered.promise;
    const enVuelo = await eventsOf(idA, empresas.a.empresaId, 3); expect(enVuelo.map((e) => `${e.attempt_no}:${e.event}`)).toEqual(["1:STARTED", "1:FINISHED", "2:STARTED"]);   // el intento 2 empezó y aún no termina
    const inicio2 = snapshot(enVuelo.find((e) => e.attempt_no === 2 && e.event === "STARTED")!);
    await ctx.db.query("UPDATE ps_api13_link_jobs SET lease_until = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE external_order_id = ?", [Buffer.from(idA)]);   // el lease del primero vence (sigue vivo)
    // Trabajador 2: reclama A (lease vencido) y B; A espera el bloqueo que sostiene el primero; se libera al primero mientras el segundo espera.
    const w2 = worker(undefined, { maxAttempts: 6 }).runOnce("w2-rapido", 5);
    await new Promise((r) => setTimeout(r, 1500)); expect((await jobsOf(idA))[0]).toMatchObject({ status: "PENDING", attempts: 3 });   // intento 3 en curso, esperando el bloqueo
    gate.resolve();
    const [r1, r2] = await Promise.all([w1, w2]);
    // Fencing: el primero perdió el lease; su resultado se descarta para el TRABAJO (aunque su alta en el TMS fue válida y atómica).
    expect(mine(r1, idA)).toMatchObject([{ attemptNo: 2, outcome: "LEASE_LOST", status: "LEASE_LOST" }]);
    expect(mine(r2, idA)).toMatchObject([{ attemptNo: 3, outcome: "ALREADY_LINKED", status: "DONE" }]); expect(mine(r2, idB)).toMatchObject([{ outcome: "LINKED", status: "DONE" }]);
    // UNA sola solicitud y UN solo vínculo definitivo por orden.
    expect(await solicitudes(idA)).toHaveLength(1); const linksA = await linkOf(idA, "d"); expect(linksA).toHaveLength(1); expect(linksA[0].solicitud_id).toBe((await solicitudes(idA))[0].id);
    expect(await count("SELECT COUNT(*) n FROM ps_api12_tms_links l JOIN ps_api01_orders o ON o.id = l.order_id WHERE o.external_order_id = ? AND l.solicitud_id IS NOT NULL", [Buffer.from(idA)])).toBe(1);
    expect((await jobsOf(idA))[0]).toMatchObject({ status: "DONE", attempts: 3, last_outcome: "ALREADY_LINKED" });
    // Registro consistente: ambos intentos, con sus eventos; el de inicio del intento 2 NO se modificó.
    const ev = await eventsOf(idA, empresas.a.empresaId, 3);
    expect(ev.map((e) => `${e.attempt_no}:${e.event}:${e.outcome ?? "-"}:${e.worker_id}`)).toEqual(["1:STARTED:-:inline", "1:FINISHED:UNMAPPED:inline", "2:STARTED:-:w1-lento", "2:FINISHED:LEASE_LOST:w1-lento", "3:STARTED:-:w2-rapido", "3:FINISHED:ALREADY_LINKED:w2-rapido"]);
    expect(snapshot(ev.find((e) => e.attempt_no === 2 && e.event === "STARTED")!)).toBe(inicio2);
    // Sin fuga entre empresas: B se vinculó a SU empresa y A a la suya; ninguna solicitud cruzó.
    expect(await solicitudes(idB, empresas.b.empresaId)).toHaveLength(1); expect(await solicitudes(idB, empresas.a.empresaId)).toHaveLength(0); expect(await solicitudes(idA, empresas.b.empresaId)).toHaveLength(0);
    const [lb] = await linkOf(idB, "b"); expect(lb.empresa_id).toBe(empresas.b.empresaId); expect((await jobsOf(idB))[0]).toMatchObject({ empresa_id: empresas.b.empresaId, status: "DONE" });
    // Recuperación tras reinicio: procesos nuevos (instancias nuevas) no encuentran nada que hacer ni duplican.
    expect(mine(await worker().runOnce("w3-reinicio"), idA)).toEqual([]); expect(mine(await worker().runOnce("w3-reinicio"), idB)).toEqual([]);
    expect(await solicitudes(idA)).toHaveLength(1); expect(await solicitudes(idB, empresas.b.empresaId)).toHaveLength(1);
  });

  it("API13.15 un trabajador que se cuelga ANTES de terminar deja un intento INTERRUMPIDO (STARTED sin FINISHED, sin resultado inventado); otro lo recupera tras vencer el lease y el rezagado, si despierta, queda como LEASE_LOST sin tocar el historial", async () => {
    const id = uid(); await unlinked("d", id); await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 10 SECOND) WHERE external_order_id = ?", [Buffer.from(id)]);
    const entered = deferred(); const gate = deferred();
    const hung = { link: async (sc: Parameters<ReturnType<typeof createTmsLinker>["link"]>[0], ext: string) => { entered.resolve(); await gate.promise; return createTmsLinker({ pool, schema, repository }).link(sc, ext); } };
    const w1 = createLinkRetry({ pool, schema, linker: hung, policy: { baseDelayMs: 0, maxAttempts: 6, leaseMs: 60000 } }).runOnce("w1-colgado", 1);
    await entered.promise;
    const interrumpido = await eventsOf(id, empresas.a.empresaId, 3);
    expect(interrumpido.map((e) => `${e.attempt_no}:${e.event}`)).toEqual(["1:STARTED", "1:FINISHED", "2:STARTED"]);   // intento 2: iniciado, sin cierre ni resultado
    const inicio = snapshot(interrumpido.find((e) => e.attempt_no === 2)!);
    expect(await worker().claim(1, { scope: scopeFull("d"), externalOrderId: id })).toHaveLength(0);   // lease vigente: nadie lo toma
    await ctx.db.query("UPDATE ps_api13_link_jobs SET lease_until = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND) WHERE external_order_id = ?", [Buffer.from(id)]);
    expect(mine(await worker(undefined, { maxAttempts: 6 }).runOnce("w2-recupera"), id)).toMatchObject([{ attemptNo: 3, outcome: "LINKED", status: "DONE" }]);
    expect(await solicitudes(id)).toHaveLength(1);
    const antesDeDespertar = (await eventsOf(id, empresas.a.empresaId, 3)).map((e) => `${e.attempt_no}:${e.event}:${e.outcome ?? "-"}`);
    expect(antesDeDespertar).toEqual(["1:STARTED:-", "1:FINISHED:UNMAPPED", "2:STARTED:-", "3:STARTED:-", "3:FINISHED:LINKED"]);   // el intento 2 sigue SIN resultado: no se inventó nada
    gate.resolve(); expect(mine(await w1, id)).toMatchObject([{ attemptNo: 2, outcome: "LEASE_LOST" }]);   // el rezagado despierta: su resultado se descarta (ya está ALREADY_LINKED, pero el trabajo es de otro)
    const ev = await eventsOf(id, empresas.a.empresaId, 3); expect(ev.map((e) => `${e.attempt_no}:${e.event}:${e.outcome ?? "-"}`)).toEqual(["1:STARTED:-", "1:FINISHED:UNMAPPED", "2:STARTED:-", "2:FINISHED:LEASE_LOST", "3:STARTED:-", "3:FINISHED:LINKED"]);
    expect(snapshot(ev.find((e) => e.attempt_no === 2 && e.event === "STARTED")!)).toBe(inicio);   // el evento de inicio jamás se modificó
    expect((await jobsOf(id))[0]).toMatchObject({ status: "DONE", attempts: 3, last_outcome: "LINKED" }); expect(await solicitudes(id)).toHaveLength(1);
  });

  it("API13.16 el registro de intentos es de solo inserción: no admite eventos duplicados ni resultados en un STARTED, y el código no actualiza ni borra el historial", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    const dup = ctx.db.query("INSERT INTO ps_api13_link_attempts (environment, tenant_id, client_id, integration_id, order_id, attempt_no, event, worker_id, outcome, recorded_at) SELECT environment, tenant_id, client_id, integration_id, order_id, 1, 'FINISHED', 'x', 'LINKED', UTC_TIMESTAMP(6) FROM ps_api13_link_jobs WHERE external_order_id = ? AND tenant_id = ?", [Buffer.from(id), empresas.a.empresaId]);
    await expect(dup).rejects.toMatchObject({ errno: 1062 });   // ya existe el FINISHED del intento 1
    const badStart = ctx.db.query("INSERT INTO ps_api13_link_attempts (environment, tenant_id, client_id, integration_id, order_id, attempt_no, event, worker_id, outcome, recorded_at) SELECT environment, tenant_id, client_id, integration_id, order_id, 9, 'STARTED', 'x', 'LINKED', UTC_TIMESTAMP(6) FROM ps_api13_link_jobs WHERE external_order_id = ? AND tenant_id = ?", [Buffer.from(id), empresas.a.empresaId]);
    await expect(badStart).rejects.toMatchObject({ errno: 4025 });   // CHECK: un STARTED no puede traer resultado
  });
});

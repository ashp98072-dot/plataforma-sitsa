// PRICESMART — homologación (auditoría de #694): el vínculo con el TMS solo sabe traducir el contrato `lab-demo-1`. Contra la app real (`next dev`) y MariaDB 11.8.9 real y desechable, con datos ficticios:
//  · una orden cuyo contrato NO es compatible con el mapeador queda `CONTRACT_NOT_MAPPED` (trabajo BLOQUEADO, sin reintentos, sin reclamo ni solicitud) y el GET pide REVISIÓN con un código acotado;
//  · NO perjudica a las órdenes ya vinculadas (siguen ALREADY_LINKED) ni a la recuperación por token (una solicitud ya creada por un intento interrumpido se completa como LINKED sin crear otra);
//  · un reclamo pendiente sin solicitud se conserva y, cuando el contrato SÍ es compatible, se completa con el mismo token.
// El contrato «no compatible» se simula devolviendo, para la misma orden REAL guardada, un `input` con otra forma (el POST por HTTP solo admite `lab-demo-1`). Solo se ejecuta desde un arnés de laboratorio (demo.mjs o run-linux.mjs).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPool } from "@/lib/db";
import { crearSolicitudCliente } from "@/lib/tms/solicitudes-cliente";
import { mariaDbOrderRepository } from "../../../src/lib/integrations/pricesmart/mariadb-repository";
import { labContract } from "../../../src/lib/integrations/pricesmart/lab-demo/contract";
import { labCipher } from "../../../src/lib/integrations/pricesmart/lab-demo/lab-crypto";
import { createTmsLinker, claimMarker } from "../../../src/lib/integrations/pricesmart/lab-demo/tms-link";
import { createLinkRetry } from "../../../src/lib/integrations/pricesmart/lab-demo/link-retry";
import type { OrderRepository } from "../../../src/lib/integrations/pricesmart/ports";
import { connect, empresas, get, labKey, post, scopeFull, type Key, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  ctx = await connect();
  // Aísla esta prueba de trabajos pendientes de otras: los aplaza un día (la app usa su retroceso normal de 30 s).
  await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 1 DAY) WHERE status = 'PENDING'");
});
afterAll(async () => { await ctx.db.end(); });
const rows: typeof ctx.rows = (...a) => ctx.rows(...a);

const schema = String(process.env.DB_NAME); const pool = getPool();
const repository = mariaDbOrderRepository(pool, { schema, runtimeUser: String(process.env.DB_USER), cipher: labCipher(labKey), contract: labContract });
/** La MISMA orden real guardada, pero con un `input` de otra forma (un contrato D06 definitivo, sin capa de mapeo hacia el TMS). */
const foreign: OrderRepository = {
  runAtomic: (scope, action) => repository.runAtomic(scope, (tx) => action({ ...tx, findForUpdate: async (id: string) => {
    const stored = await tx.findForUpdate(id);
    return stored && { ...stored, input: { schemaVersion: "d06-definitivo-1", externalOrderId: id, originClubReference: stored.input.originClubReference, consignee: { legalName: "Destinatario D06" }, deliveryWindow: { from: "2030-01-15" } } as never };
  } } as never)),
};
const linkerOf = (repo: OrderRepository, createRequest?: typeof crearSolicitudCliente) => createTmsLinker({ pool, schema, repository: repo, createRequest });
const worker = (repo: OrderRepository) => createLinkRetry({ pool, schema, linker: linkerOf(repo), policy: { baseDelayMs: 0, maxAttempts: 3, leaseMs: 60000 } });
const nm = () => `NM${randomBytes(5).toString("hex")}`;   // no empieza por «PS»: las otras pruebas no los tocan
const due = (id: string) => ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE external_order_id = ? AND status = 'PENDING'", [Buffer.from(id)]);
const jobOf = async (id: string) => (await rows("SELECT status, attempts, last_outcome FROM ps_api13_link_jobs WHERE external_order_id = ?", [Buffer.from(id)]))[0] as Row | undefined;
const solicitudes = (id: string) => rows("SELECT id, observaciones FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ? ORDER BY id", [empresas.a.empresaId, id]);
const linkOf = async (id: string) => (await rows("SELECT l.claim_token, l.solicitud_id FROM ps_api12_tms_links l JOIN ps_api01_orders o ON o.environment = l.environment AND o.tenant_id = l.tenant_id AND o.client_id = l.client_id AND o.integration_id = l.integration_id AND o.id = l.order_id WHERE o.tenant_id = ? AND o.external_order_id = ?", [empresas.a.empresaId, Buffer.from(id)]))[0] as Row | undefined;

/** Recibe una orden SIN vinculación inmediata: quita el mapeo administrativo durante el POST y lo restaura (la orden queda guardada y el trabajo encolado como UNMAPPED). */
async function unlinked(key: Key, id: string) {
  const s = scopeFull(key); const saved = await rows("SELECT * FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  await ctx.db.query("DELETE FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  try { expect((await post(key, id)).status).toBe(202); } finally {
    for (const m of saved) await ctx.db.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (?,?,?,?,?,?,?,?,?)",
      [m.environment, m.tenant_id, m.client_id, m.integration_id, m.empresa_id, m.tms_cliente_id, m.tms_usuario_cliente_id, m.pickup_place, m.dropoff_place]);
  }
}

describe("CONTRACT_NOT_MAPPED, órdenes ya vinculadas y recuperación por token", () => {
  it("NM.1 contrato no mapeable: trabajo BLOQUEADO de inmediato (sin reintentos), sin reclamo ni solicitud, y el GET pide REVISIÓN con un código acotado", async () => {
    const id = nm(); await unlinked("a", id);
    expect(await linkOf(id)).toBeUndefined(); expect(await solicitudes(id)).toHaveLength(0);   // el POST sin mapeo no dejó nada en el TMS
    await due(id);
    const out = await worker(foreign).attemptNow(scopeFull("a"), id, "e2e");
    expect(out).toMatchObject([{ externalOrderId: id, outcome: "CONTRACT_NOT_MAPPED", status: "BLOCKED" }]);
    const job = await jobOf(id); expect(job).toMatchObject({ status: "BLOCKED", last_outcome: "CONTRACT_NOT_MAPPED" });
    expect(await linkOf(id)).toBeUndefined(); expect(await solicitudes(id)).toHaveLength(0);   // sin reclamo y sin solicitud
    const g = await get("a", id);
    expect(g.status).toBe(200); expect(g.json).toMatchObject({ proposedStatus: "REVIEW_REQUIRED", confirmsDelivery: false, tms: { linked: false, linkIssue: { status: "BLOCKED", code: "CONTRACT_NOT_MAPPED" } } });
    expect(JSON.stringify(g.json)).not.toMatch(/D06|consignee|Destinatario/);   // solo el código; nunca datos de la orden
    // No se reintenta solo: otro ciclo del trabajador no lo toca.
    await due(id); await worker(foreign).runOnce("e2e-2");
    expect(await jobOf(id)).toMatchObject({ status: "BLOCKED", attempts: job!.attempts });
  });

  it("NM.2 una orden YA VINCULADA no se ve afectada: sigue ALREADY_LINKED aunque su contrato no sea mapeable; no se crea otra solicitud y el GET sigue vinculado", async () => {
    const id = nm(); expect((await post("a", id)).status).toBe(202);
    const before = (await linkOf(id))!; expect(before.solicitud_id).not.toBeNull();
    const r = await linkerOf(foreign).link(scopeFull("a"), id);
    expect(r).toMatchObject({ state: "ALREADY_LINKED", solicitudId: Number(before.solicitud_id) });
    expect(await solicitudes(id)).toHaveLength(1); expect(await linkOf(id)).toMatchObject({ solicitud_id: before.solicitud_id });
    expect(await jobOf(id)).toMatchObject({ status: "DONE", last_outcome: "LINKED" });
    expect((await get("a", id)).json.tms).toMatchObject({ linked: true, requestState: "SOLICITADA" });
  });

  it("NM.3 RECUPERACIÓN POR TOKEN: la solicitud creada por un intento interrumpido (reclamo sin completar) se completa como LINKED aunque el contrato no sea mapeable; no se crea otra", async () => {
    const id = nm(); await unlinked("a", id);
    const crashAfterCreate: typeof crearSolicitudCliente = async (c, input) => { await crearSolicitudCliente(c, input); throw new Error("caída simulada tras crear la solicitud"); };   // sin el gancho: el vínculo no se completa
    await expect(linkerOf(repository, crashAfterCreate).link(scopeFull("a"), id)).rejects.toThrow("caída simulada");
    const claim = (await linkOf(id))!; expect(claim.solicitud_id).toBeNull();
    const created = await solicitudes(id); expect(created).toHaveLength(1); expect(String(created[0].observaciones).startsWith(claimMarker(claim.claim_token as Buffer))).toBe(true);
    const noCrear = vi.fn(async () => { throw new Error("no debe crear otra solicitud"); });
    const r = await linkerOf(foreign, noCrear as never).link(scopeFull("a"), id);
    expect(r).toMatchObject({ state: "LINKED", solicitudId: Number(created[0].id) }); expect(noCrear).not.toHaveBeenCalled();
    expect(await solicitudes(id)).toHaveLength(1); expect(await linkOf(id)).toMatchObject({ solicitud_id: created[0].id });
  });

  it("NM.4 un RECLAMO pendiente SIN solicitud: con contrato no mapeable se conserva (mismo token, sin solicitud) y, con el contrato compatible, se completa con ESE token", async () => {
    const id = nm(); await unlinked("a", id);
    await expect(linkerOf(repository, (async () => { throw new Error("caída antes de crear"); }) as never).link(scopeFull("a"), id)).rejects.toThrow("caída antes de crear");
    const claim = (await linkOf(id))!; expect(claim.solicitud_id).toBeNull(); expect(await solicitudes(id)).toHaveLength(0);
    expect(await linkerOf(foreign).link(scopeFull("a"), id)).toMatchObject({ state: "CONTRACT_NOT_MAPPED" });
    expect(await linkOf(id)).toMatchObject({ solicitud_id: null }); expect((await linkOf(id))!.claim_token).toEqual(claim.claim_token); expect(await solicitudes(id)).toHaveLength(0);   // nada cambió
    const r = await linkerOf(repository).link(scopeFull("a"), id);
    expect(r).toMatchObject({ state: "LINKED" });
    const [s] = await solicitudes(id); expect(await solicitudes(id)).toHaveLength(1);
    expect(String(s.observaciones).startsWith(claimMarker(claim.claim_token as Buffer))).toBe(true);   // se reutilizó el reclamo existente
  });

  it("NM.5 las órdenes lab-demo-1 siguen vinculándose igual (POST → vínculo inmediato → GET vinculado) mientras existen órdenes bloqueadas por contrato", async () => {
    const id = nm(); expect((await post("a", id)).status).toBe(202);
    expect(await jobOf(id)).toMatchObject({ status: "DONE", last_outcome: "LINKED" });
    expect((await get("a", id)).json.tms).toMatchObject({ linked: true });
  });
});

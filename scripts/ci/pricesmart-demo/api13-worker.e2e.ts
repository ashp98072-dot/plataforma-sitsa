// PRICESMART-API-13 — trabajador de reintentos DENTRO de la app (tras `demo.mjs restart-app --worker-ms=3000`): las órdenes guardadas sin vincular se vinculan solas, sin POST y sin
// intervención de la prueba, incluso después de que la app se reinició (el estado vive en MariaDB). Solo se ejecuta desde demo.mjs.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, empresas, post, scopeFull, uid, type Key, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { ctx = await connect(); });
afterAll(async () => { await ctx.db.end(); });
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function withoutMapping<T>(key: Key, fn: () => Promise<T>): Promise<T> {
  const s = scopeFull(key); const saved = await ctx.rows("SELECT * FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  await ctx.db.query("DELETE FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  try { return await fn(); } finally {
    for (const m of saved as Row[]) await ctx.db.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (?,?,?,?,?,?,?,?,?)",
      [m.environment, m.tenant_id, m.client_id, m.integration_id, m.empresa_id, m.tms_cliente_id, m.tms_usuario_cliente_id, m.pickup_place, m.dropoff_place]);
  }
}

describe("API-13 trabajador dentro de la app", () => {
  it("API13.17 tras reiniciar la app, el trabajador vincula solo las órdenes pendientes (sin POST) y registra su intento con su propio identificador", async () => {
    const ids = [uid(), uid(), uid()];
    await withoutMapping("d", async () => { for (const id of ids) expect((await post("d", id)).status).toBe(202); });
    for (const id of ids) expect(await ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, id])).toBe(0);
    await ctx.db.query("UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING' AND external_order_id IN (?, ?, ?)", ids.map((i) => Buffer.from(i)));
    const deadline = Date.now() + 60000; let linked = 0;
    while (Date.now() < deadline) {
      linked = 0; for (const id of ids) linked += await ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, id]);
      if (linked === ids.length) break; await sleep(1500);
    }
    expect(linked).toBe(ids.length);   // exactamente una solicitud por orden
    for (const id of ids) {
      const [job] = await ctx.rows("SELECT status, attempts FROM ps_api13_link_jobs WHERE external_order_id = ?", [Buffer.from(id)]); expect(job).toMatchObject({ status: "DONE", attempts: 2 });
      const log = await ctx.rows("SELECT worker_id, outcome FROM ps_api13_link_attempts WHERE event = 'FINISHED' AND order_id = (SELECT order_id FROM ps_api13_link_jobs WHERE external_order_id = ?) ORDER BY attempt_no", [Buffer.from(id)]);
      expect(log.map((l) => l.outcome)).toEqual(["UNMAPPED", "LINKED"]); expect(log[1].worker_id).toMatch(/^w[0-9a-f]{12}$/);   // el segundo intento lo hizo el trabajador de la app, no la vía rápida
    }
  });
});

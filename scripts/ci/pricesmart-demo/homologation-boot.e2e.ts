// PRICESMART — ARRANQUE REAL del runtime de homologación (src/instrumentation.ts → homologation/boot.ts) por las RUTAS HTTP REALES de Next.js (`next dev`) contra MariaDB 11.8.9 real y desechable, con un esquema
// `sandbox_api02_homolog_test1` aprovisionado por el paquete real (apply + finalize), cuentas de MÍNIMO privilegio (aplicación y worker) y datos ficticios.
// El runner arranca la app con una configuración distinta por escenario (`PS_HB_SCENARIO`): por defecto apagado; cerrado sin proveedores revisados; cerrado sin decisiones ratificadas; abierto con proveedores SINTÉTICOS de prueba
// (solo permitidos en este entorno local, nunca en `next start`); y el mismo abierto tras REINICIAR la app. Las «decisiones ratificadas» de estas pruebas son una DECLARACIÓN DE LA PRUEBA, no una ratificación de PriceSmart.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cancel, connect, empresas, get, post, scopeFull, uid, labOrder } from "./e2e-support";

const scenario = String(process.env.PS_HB_SCENARIO); const step = String(process.env.PS_HB_STEP ?? "1");
const killFile = String(process.env.PS_HB_KILLFILE); const runDir = String(process.env.PS_DEMO_RUNDIR); const pendingFile = path.join(runDir, "hb-pending.json");
let ctx: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { ctx = await connect(); });
afterAll(async () => { await ctx.db.end(); });
const rows: typeof ctx.rows = (...a) => ctx.rows(...a);
const A = () => empresas.a.empresaId;
const bootLine = () => { const lines = readFileSync(path.join(runDir, "next.log"), "utf8").split("\n").filter((l) => l.includes("[pricesmart] runtime de homologación")); return lines.at(-1) ?? ""; };
const workerConnections = async () => Number((await rows("SELECT COUNT(*) n FROM information_schema.PROCESSLIST WHERE USER = ?", [String(process.env.PS_HB_WORKER_USER)]))[0].n);
const counts = async () => ({ orders: Number((await rows("SELECT COUNT(*) n FROM ps_api01_orders"))[0].n), outbox: Number((await rows("SELECT COUNT(*) n FROM ps_api01_outbox"))[0].n) });
const solicitudes = async (id: string) => Number((await rows("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id]))[0].n);
const waitFor = async (fn: () => Promise<boolean>, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 400)); } return false; };
/** Adelanta los reintentos (simula el paso del tiempo; los intervalos de retroceso normales son de decenas de segundos). */
const due = async () => { for (const sql of ["UPDATE ps_api01_outbox SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING'", "UPDATE ps_api13_link_jobs SET next_attempt_at = UTC_TIMESTAMP(6) WHERE status = 'PENDING'"]) { for (let i = 0; i < 6; i++) { try { await ctx.db.query(sql); break; } catch (e) { if ((e as { code?: string }).code !== "ER_LOCK_DEADLOCK") throw e; } } } };
async function withoutMapping<T>(fn: (restore: () => Promise<void>) => Promise<T>): Promise<T> {
  const s = scopeFull("a"); const saved = await rows("SELECT * FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  await ctx.db.query("DELETE FROM ps_api12_tms_mapping WHERE tenant_id = ? AND client_id = ?", [s.tenantId, s.clientId]);
  let done = false; const restore = async () => { if (done) return; done = true; for (const m of saved) await ctx.db.query("INSERT INTO ps_api12_tms_mapping (environment, tenant_id, client_id, integration_id, empresa_id, tms_cliente_id, tms_usuario_cliente_id, pickup_place, dropoff_place) VALUES (?,?,?,?,?,?,?,?,?)", [m.environment, m.tenant_id, m.client_id, m.integration_id, m.empresa_id, m.tms_cliente_id, m.tms_usuario_cliente_id, m.pickup_place, m.dropoff_place]); };
  try { return await fn(restore); } finally { await restore(); }
}

describe.skipIf(scenario !== "default")("HB.1 por defecto (sin PRICESMART_RUNTIME_MODE) el runtime está APAGADO", () => {
  it("las rutas reales responden 503 DISABLED, no se guarda nada, no hay conexiones del worker y el arranque no registró ningún runtime", async () => {
    const before = await counts();
    const r = await post("a", uid()); expect(r.status).toBe(503); expect(r.json.code).toBe("DISABLED");
    const g = await get("a", uid()); expect(g.status).toBe(503); expect(g.json.code).toBe("DISABLED"); expect((await cancel("a", uid())).status).toBe(503);
    expect(await counts()).toEqual(before); expect(await workerConnections()).toBe(0); expect(bootLine()).toBe("");
  });
});

describe.skipIf(scenario !== "no-providers")("HB.2 modo ENABLED con decisiones, ACK e interruptor, pero SIN proveedores revisados (verificador D02, KMS, contrato D06)", () => {
  it("el arranque queda CERRADO con PROVIDERS_NOT_AVAILABLE; las rutas responden 503 y no se abre ninguna conexión del worker", async () => {
    expect(bootLine()).toMatch(/CLOSED \(PROVIDERS_NOT_AVAILABLE\)/);
    const before = await counts(); const r = await post("a", uid()); expect(r.status).toBe(503); expect(r.json.code).toBe("DISABLED"); expect(await counts()).toEqual(before); expect(await workerConnections()).toBe(0);
  });
});

describe.skipIf(scenario !== "no-decisions")("HB.3 proveedores de prueba presentes, pero decisiones NO ratificadas / sin ACK del operador", () => {
  it("el arranque queda CERRADO (DECISION_PENDING / configuración inválida); las rutas responden 503 y el consumidor no arranca", async () => {
    expect(bootLine()).toMatch(/CLOSED \((DECISION_PENDING|CONFIG_INVALID)/);
    const before = await counts(); const r = await post("a", uid()); expect(r.status).toBe(503); expect(r.json.code).toBe("DISABLED"); expect(await counts()).toEqual(before);
    expect(await workerConnections()).toBe(0);   // el pool del worker se cerró al no instalarse
  });
});

describe.skipIf(scenario !== "open" || step !== "1")("HB.4–HB.6 runtime ENABLED por las rutas HTTP reales (proveedores SINTÉTICOS de prueba)", () => {
  it("HB.4 el arranque INSTALÓ el runtime con proveedores sintéticos solo-prueba y el consumidor de la outbox corre", () => { expect(bootLine()).toMatch(/INSTALLED \(sin bloqueos\)/); });
  it("HB.4b POST → recepción durable → outbox → solicitud del TMS (UNA) → GET; duplicados y conflicto; cancelación idempotente y auditada; autenticación y aislamiento", async () => {
    const id = uid(); const p = await post("a", id); expect(p.status).toBe(202); expect(p.json).toMatchObject({ externalOrderId: id, provisionalStatus: "RECEIVED" });
    expect(await waitFor(async () => (await solicitudes(id)) === 1)).toBe(true);   // la outbox + el vínculo con el TMS procesaron la orden SIN intervención
    expect(await waitFor(async () => (await rows("SELECT status FROM ps_api01_outbox o JOIN ps_api01_orders r ON r.id = o.order_id WHERE r.external_order_id = ?", [Buffer.from(id)])).every((x) => x.status === "DONE"))).toBe(true);
    const g = await get("a", id); expect(g.status).toBe(200); expect(g.json).toMatchObject({ confirmsDelivery: false, tms: { linked: true, requestState: "SOLICITADA" } });
    expect((await post("a", id)).status).toBe(202); expect(await solicitudes(id)).toBe(1);   // idempotente
    expect((await post("a", id, labOrder(id, { address: "Otra dirección" }))).status).toBe(409);
    const c = await cancel("a", id); expect(c.status).toBe(202); expect((await cancel("a", id)).status).toBe(202); expect((await cancel("a", id, "DUPLICATE")).status).toBe(409);
    expect(await waitFor(async () => Number((await rows("SELECT COUNT(*) n FROM auditoria WHERE empresa_id = ? AND accion = 'pricesmart_cancelacion_solicitada'", [A()]))[0].n) >= 1)).toBe(true);
    expect((await get("a", id)).json).toMatchObject({ confirmsDelivery: false, cancellation: { requested: true, automatic: false } });
    const noAuth = await post(null, uid()); expect(noAuth.status).toBe(401); expect((await post("a", uid(), undefined, { tamper: true })).status).toBe(401);
    expect((await get("b", id)).status).toBe(404);   // otra empresa no ve la orden
    expect(await solicitudes(id)).toBe(1);
  });
  it("HB.5 reintentos: una orden recibida sin mapeo queda pendiente (sin duplicar) y, al restaurarlo, el consumidor la vincula SIN que PriceSmart reenvíe", async () => {
    const id = uid(); await withoutMapping(async (restore) => {
      expect((await post("a", id)).status).toBe(202); await new Promise((r) => setTimeout(r, 2500)); expect(await solicitudes(id)).toBe(0);
      const g = await get("a", id); expect(g.status).toBe(200); expect(g.json.confirmsDelivery).toBe(false);
      await restore();
    });
    await due(); expect(await waitFor(async () => { await due(); return (await solicitudes(id)) === 1; }, 60000)).toBe(true);
    expect((await get("a", id)).json).toMatchObject({ tms: { linked: true } }); expect(await solicitudes(id)).toBe(1);
  });
  it("HB.6 apagado seguro: con el interruptor en OFF las rutas responden 503 al instante y el consumidor NO procesa; lo recibido se conserva y se procesa al reactivar", async () => {
    const id = uid();
    await withoutMapping(async () => { expect((await post("a", id)).status).toBe(202); await new Promise((x) => setTimeout(x, 1500)); expect(await solicitudes(id)).toBe(0); });   // orden recibida y NO vinculada (sin mapeo); el mapeo ya está restaurado
    writeFileSync(killFile, "OFF\n");
    for (const r of [await post("a", uid()), await get("a", id), await cancel("a", id)]) { expect(r.status).toBe(503); expect(r.json.code).toBe("DISABLED"); }
    await due(); await new Promise((x) => setTimeout(x, 4000)); expect(await solicitudes(id)).toBe(0);   // el consumidor está pausado: no escribe en el TMS con el servicio apagado
    writeFileSync(killFile, "ON\n"); expect(await waitFor(async () => { await due(); return (await solicitudes(id)) === 1; }, 60000)).toBe(true);
    expect((await get("a", id)).status).toBe(200);
  });
  it("HB.6b se deja UNA orden pendiente (sin mapeo) y UNA vinculada para comprobar la recuperación tras REINICIAR la app", async () => {
    const linked = uid(); expect((await post("a", linked)).status).toBe(202); expect(await waitFor(async () => (await solicitudes(linked)) === 1)).toBe(true);
    const pending = uid(); await withoutMapping(async () => { expect((await post("a", pending)).status).toBe(202); await new Promise((x) => setTimeout(x, 1500)); expect(await solicitudes(pending)).toBe(0); });
    writeFileSync(pendingFile, JSON.stringify({ linked, pending }));
  });
});

describe.skipIf(scenario !== "open" || step !== "2")("HB.7 tras REINICIAR la app: arranque, recuperación y continuidad", () => {
  it("el arranque vuelve a instalar el runtime; lo recibido antes del reinicio sigue ahí; la orden pendiente se vincula sin reenvío y sin duplicar; el servicio sigue operando", async () => {
    const { linked, pending } = JSON.parse(readFileSync(pendingFile, "utf8")) as { linked: string; pending: string };
    expect(bootLine()).toMatch(/INSTALLED \(sin bloqueos\)/);
    const g = await get("a", linked); expect(g.status).toBe(200); expect(g.json).toMatchObject({ confirmsDelivery: false, tms: { linked: true } }); expect(await solicitudes(linked)).toBe(1);
    expect(await waitFor(async () => { await due(); return (await solicitudes(pending)) === 1; }, 60000)).toBe(true); expect((await get("a", pending)).json).toMatchObject({ tms: { linked: true } }); expect(await solicitudes(pending)).toBe(1);
    const again = await post("a", pending); expect(again.status).toBe(202); expect(await solicitudes(pending)).toBe(1);   // reenviar tras el reinicio no duplica
    const fresh = uid(); expect((await post("a", fresh)).status).toBe(202); expect(await waitFor(async () => (await solicitudes(fresh)) === 1)).toBe(true);
    expect(await workerConnections()).toBeGreaterThan(0);   // el consumidor volvió a abrir su pool con la cuenta del worker
  });
});

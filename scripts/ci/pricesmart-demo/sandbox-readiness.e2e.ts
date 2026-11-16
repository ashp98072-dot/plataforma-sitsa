// PRICESMART-API-25 — escenarios del sandbox de homologación sobre el laboratorio local (mismo arnés de API-12/13/23/24): consulta periódica (PriceSmart consulta cada orden ~cada hora), evidencia de entrega
// (sin afirmar entrega), y controles que impiden tratar la composición local como producción. Solo se ejecuta desde demo.mjs. NADA de esto es un sandbox público ni una credencial externa.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { programarSolicitud, tomarEnRevisionSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";
import { BASE, cancel, connect, empresas, get, post, uid, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>; let perfilId = 0;
beforeAll(async () => {
  ctx = await connect();
  perfilId = Number(((await ctx.db.query("INSERT INTO tms_cotizacion_costeo_perfiles (empresa_id, codigo, nombre, dias_operacion_mes, vida_util_aceite_km, vida_util_llantas_km, rendimiento_km_galon) VALUES (?, ?, 'Camión 5T ficticio', 26, 5000, 50000, 10)", [empresas.a.empresaId, `H25-${uid()}`]))[0] as unknown as { insertId: number }).insertId);
});
afterAll(async () => { await ctx.db.end(); });
const A = () => empresas.a.empresaId;
const solicitud = async (id: string) => (await ctx.rows("SELECT id, estado, plan_id, version FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id]))[0] as Row;
async function scheduled(): Promise<{ id: string; planId: number }> {
  const id = uid(); expect((await post("a", id)).status).toBe(202);
  let s = await solicitud(id); expect((await tomarEnRevisionSolicitud(A(), Number(s.id), Number(s.version), "ops.lab")).ok).toBe(true);
  s = await solicitud(id); const p = await programarSolicitud(A(), Number(s.id), Number(s.version), "ops.lab", perfilId); expect(p.ok, JSON.stringify(p)).toBe(true);
  return { id, planId: Number((await solicitud(id)).plan_id) };
}
const evidence = async (id: string) => ((await get("a", id)).json.tms as Row).deliveryEvidence as Row | undefined;
const setPlan = (planId: number, estado: string) => ctx.db.query("UPDATE tms_planes_viaje SET estado = ? WHERE empresa_id = ? AND id = ?", [estado, A(), planId]);
const stopsOf = (planId: number) => ctx.rows("SELECT id, tipo, orden, lugar_nombre FROM tms_plan_paradas WHERE plan_id = ? ORDER BY orden", [planId]);
async function confirm(planId: number, stop: Row, resultado: string, over: Row = {}) {
  const ok = resultado === "ENTREGADA_POR_PILOTO";
  await ctx.db.query("INSERT INTO tms_parada_confirmaciones (empresa_id, plan_id, viaje_id, parada_id, parada_tipo, parada_orden, parada_lugar_nombre, resultado, revision, entrega_vigente, piloto_empleado_id, piloto_personal_id, piloto_usuario, evidencia_id, evidencia_ruta, nota, confirmado_en) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'piloto.lab', ?, 'lab/evidencia.jpg', ?, NOW())",
    [A(), planId, stop.id, stop.tipo, stop.orden, stop.lugar_nombre, resultado, ok ? "NO_REQUERIDA" : "PENDIENTE", ok ? 1 : null, over.evidenciaId ?? 7, ok ? null : "Nota de revisión ficticia"]);
}

describe("API-25 consulta periódica (PriceSmart consulta cada orden ~cada hora)", () => {
  it("S1 consultar 12 órdenes en distintos estados varias veces y en ráfaga: respuestas estables, solo auditoría de acceso (1 fila por consulta), sin 429/503 y sin datos sensibles", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) { const id = uid(); expect((await post("a", id)).status).toBe(202); ids.push(id); }
    const sched = [await scheduled(), await scheduled()]; ids.push(...sched.map((s) => s.id));
    const snapshot = async () => [await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders"), await ctx.count("SELECT COUNT(*) n FROM ps_api01_events"), await ctx.count("SELECT COUNT(*) n FROM ps_api01_outbox"),
      await ctx.count("SELECT COUNT(*) n FROM ps_api01_audit"), await ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente"), await ctx.count("SELECT COUNT(*) n FROM tms_planes_viaje"), await ctx.count("SELECT COUNT(*) n FROM auditoria")];
    const antes = await snapshot();
    const rounds: Row[][] = [];
    for (let r = 0; r < 3; r++) rounds.push((await Promise.all(ids.map((id) => get("a", id)))).map((x) => { expect(x.status, JSON.stringify(x.json)).toBe(200); return x.json; }));
    for (let i = 0; i < ids.length; i++) {
      const strip = (j: Row) => { const { correlationId, ...rest } = j; void correlationId; return JSON.stringify(rest); };
      expect(strip(rounds[1][i]), ids[i]).toBe(strip(rounds[0][i])); expect(strip(rounds[2][i])).toBe(strip(rounds[0][i]));   // la consulta es estable e idempotente
      expect(rounds[0][i].confirmsDelivery).toBe(false);
    }
    // Consultar NO cambia el estado de negocio (órdenes, eventos, outbox, solicitudes, planes, auditoría del TMS). Lo ÚNICO que se escribe es la auditoría de acceso de la integración (`ps_api01_audit`, API-01):
    // exactamente UNA fila por consulta (y ninguna por las rechazadas). Retención de esa auditoría = D14 (pendiente): con consultas periódicas crece N órdenes × consultas/día.
    const despues = await snapshot(); const reads = rounds.length * ids.length;
    expect(despues.filter((_, i) => i !== 3)).toEqual(antes.filter((_, i) => i !== 3)); expect(despues[3] - antes[3]).toBe(reads);
    const text = JSON.stringify(rounds);
    expect(text).not.toMatch(/Avenida Ficticia|Club Ficticio|payload|ciphertext|claim|lease|DELIVERED|ENTREGAD/i);
    expect(rounds[0].map((j) => j.proposedStatus).filter((s) => s === "SCHEDULED")).toHaveLength(2); expect(rounds[0].filter((j) => j.proposedStatus === "RECEIVED").length).toBeGreaterThanOrEqual(1);
    expect((await get("b", ids[0])).status).toBe(404);   // otra empresa no ve la orden aunque la consulte con la misma referencia
    expect((await get("rev", ids[0])).status).toBe(401); expect((await get(null, ids[0])).status).toBe(401);
  });
});

describe("API-25 evidencia de entrega: nunca se afirma entrega, ni con «Descargado» ni con «Cerrado»", () => {
  it("S2 Descargado y Cerrado, sin confirmación del piloto, NO confirman entrega: evidencia NONE y estados «sin confirmar»", async () => {
    const { id, planId } = await scheduled();   // (la ausencia de la tabla de confirmaciones → UNAVAILABLE se prueba en homologation.test.ts con la base simulada)
    expect(await evidence(id)).toMatchObject({ level: "NONE", confirmsDelivery: false, publishable: false });
    for (const [plan, external] of [["Descargado", "UNLOADED_UNCONFIRMED"], ["Cerrado", "CLOSED_ADMINISTRATIVE"]] as const) {
      await setPlan(planId, plan); const g = (await get("a", id)).json; expect(g).toMatchObject({ proposedStatus: external, confirmsDelivery: false }); expect(JSON.stringify(g)).not.toMatch(/DELIVERED|ENTREGAD/i);
    }
  });

  it("S3 con confirmaciones del piloto: NONE → PILOT_CONFIRMED_ALL; sigue sin aceptarse por PriceSmart, sin cambiar el estado externo y sin publicar", async () => {
    const sql = readFileSync(path.join(process.cwd(), "sql/migrate-2026-11-tms-parada-confirmaciones.sql"), "utf8");
    const statement = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";")[0];   // única sentencia CREATE TABLE, SOLO en la base desechable del laboratorio
    expect(statement.trim().startsWith("CREATE TABLE IF NOT EXISTS tms_parada_confirmaciones")).toBe(true); await ctx.db.query(statement);
    const { id, planId } = await scheduled(); await setPlan(planId, "Descargado");
    expect(await evidence(id)).toMatchObject({ level: "NONE", deliveryStops: 1, pilotConfirmed: 0, officialAcceptance: "NOT_ACCEPTED_BY_PRICESMART", confirmsDelivery: false, publishable: false, blockedBy: ["D13_PENDING"] });
    const entrega = (await stopsOf(planId)).find((s) => s.tipo === "Entrega")!; await confirm(planId, entrega, "ENTREGADA_POR_PILOTO");
    const g = (await get("a", id)).json;
    expect((g.tms as Row).deliveryEvidence).toMatchObject({ level: "PILOT_CONFIRMED_ALL", pilotConfirmed: 1, pendingReview: 0, confirmsDelivery: false, publishable: false, officialAcceptance: "NOT_ACCEPTED_BY_PRICESMART" });
    expect(g).toMatchObject({ proposedStatus: "UNLOADED_UNCONFIRMED", confirmsDelivery: false });   // lo que ve PriceSmart NO cambia hasta que D13 se ratifique
    expect(JSON.stringify(g)).not.toMatch(/DELIVERED|ENTREGAD|piloto\.lab|evidencia\.jpg/i);   // ni usuario del piloto ni ruta de evidencia
  });

  it("S4 una entrega PARCIAL/INCIDENCIA pendiente de revisión humana → REVIEW_REQUIRED (no «entregada»)", async () => {
    const { id, planId } = await scheduled(); await setPlan(planId, "En ruta");
    const entrega = (await stopsOf(planId)).find((s) => s.tipo === "Entrega")!; await confirm(planId, entrega, "PARCIAL");
    expect(await evidence(id)).toMatchObject({ level: "REVIEW_REQUIRED", pendingReview: 1, confirmsDelivery: false });
    expect((await get("a", id)).json).toMatchObject({ proposedStatus: "IN_TRANSIT", confirmsDelivery: false });
  });

  it("S5 cancelación pedida con la entrega ya confirmada por el piloto: solo constancia, el plan y la solicitud no cambian, nada se elimina", async () => {
    const { id, planId } = await scheduled(); await setPlan(planId, "Descargado");
    const entrega = (await stopsOf(planId)).find((s) => s.tipo === "Entrega")!; await confirm(planId, entrega, "ENTREGADA_POR_PILOTO");
    expect((await cancel("a", id)).status).toBe(202);
    expect((await get("a", id)).json).toMatchObject({ cancellation: { requested: true, automatic: false, assessment: "BLOCKED_COMPLETED" }, confirmsDelivery: false });
    expect((await solicitud(id)).estado).toBe("PROGRAMADA");
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [A(), Buffer.from(id)])).toBe(1);   // sin eliminación física
    expect(await ctx.count("SELECT COUNT(*) n FROM tms_parada_confirmaciones WHERE empresa_id = ? AND plan_id = ?", [A(), planId])).toBe(1);   // el historial de confirmaciones se conserva
  });
});

describe("API-25 la composición local no es producción ni un sandbox público", () => {
  it("S6 el diagnóstico administrativo sigue ready=false, bloqueado y sin exponer valores, aunque el laboratorio esté activo", async () => {
    const res = await fetch(`${BASE}/api/admin/pricesmart/readiness`, { headers: { cookie: ctx.cookie } }); expect(res.status).toBe(200);
    const d = (await res.json()) as Row; expect(d.ready).toBe(false);
    expect(d.blockers).toEqual(expect.arrayContaining(["PRODUCTION_COMPOSITION_NOT_IMPLEMENTED", "KMS_PROVIDER_NOT_SELECTED", "PRODUCTION_ENVIRONMENT_NOT_AUTHORIZED"]));
    expect(JSON.stringify(d)).not.toMatch(new RegExp(`${process.env.DB_PASSWORD}|${process.env.PS06A_WORKER_PASSWORD}|PRICESMART_LAB_KEY=`));
    expect((await fetch(`${BASE}/api/admin/pricesmart/readiness`)).status).toBeGreaterThanOrEqual(401);   // sin sesión no hay diagnóstico
  });
});

// PRICESMART-API-24 — escenarios de HOMOLOGACIÓN sintéticos que faltaban sobre el laboratorio de API-12/13/23 (mismo arnés, sin sistema paralelo): órdenes inválidas, órdenes que el TMS rechaza, matriz de estados reales del TMS
// contra el contrato externo propuesto (nunca afirma entrega), cancelación contra cada estado y protección contra exposición de datos. Solo se ejecuta desde demo.mjs. Todo lo que dice «provisional» sigue pendiente de PriceSmart.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { programarSolicitud, rechazarSolicitud, tomarEnRevisionSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";
import { cancel, connect, empresas, get, labOrder, post, uid, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>; let perfilId = 0;
beforeAll(async () => {
  ctx = await connect();
  perfilId = Number(((await ctx.db.query("INSERT INTO tms_cotizacion_costeo_perfiles (empresa_id, codigo, nombre, dias_operacion_mes, vida_util_aceite_km, vida_util_llantas_km, rendimiento_km_galon) VALUES (?, ?, 'Camión 5T ficticio', 26, 5000, 50000, 10)", [empresas.a.empresaId, `H24-${uid()}`]))[0] as unknown as { insertId: number }).insertId);
});
afterAll(async () => { await ctx.db.end(); });
const A = () => empresas.a.empresaId;
const solicitud = async (id: string) => (await ctx.rows("SELECT id, estado, plan_id, version FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id]))[0] as Row;
const orders = (id: string) => ctx.count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [A(), Buffer.from(id)]);
const logText = () => { try { return readFileSync(path.join(String(process.env.PS_DEMO_RUNDIR), "next.log"), "utf8"); } catch { return ""; } };

describe("API-24 homologación del contrato provisional lab-demo-1", () => {
  it("H1 órdenes inválidas → 400 con SOLO {code, correlationId} (sin eco de lo enviado), nada persistido; cuerpo excesivo → 413", async () => {
    const secret = `Secreto-${uid()}`;
    const bad: Array<[string, (id: string) => unknown]> = [
      ["sin destinatario", (id) => { const { recipient: _r, ...rest } = labOrder(id); void _r; return { ...rest, address: secret }; }],
      ["varias entregas (D05/D06 pendiente)", (id) => ({ ...labOrder(id), deliveries: [{ name: secret }, { name: "B" }] })],
      ["campo desconocido", (id) => ({ ...labOrder(id), [secret]: 1 })],
      ["fecha imposible", (id) => labOrder(id, { deliveryDate: "2030-02-31", address: secret })],
      ["dirección vacía", (id) => labOrder(id, { address: "   ", notes: secret })],
      ["versión de esquema desconocida", (id) => labOrder(id, { schemaVersion: secret })],
      ["destinatario como texto", (id) => labOrder(id, { recipient: secret })],
      ["no cabe en las observaciones del TMS (antes se truncaba en silencio)", (id) => labOrder(id, { originClubReference: "QA-CLUB", recipient: { name: secret + "N".repeat(190) }, notes: "x".repeat(200), address: "ok" })],
      ["cuerpo no objeto", () => [secret]],
    ];
    for (const [name, make] of bad) {
      const id = uid(); const r = await post("a", id, make(id));
      expect(r.status, name).toBe(400); expect(Object.keys(r.json).sort(), name).toEqual(["code", "correlationId"]); expect(JSON.stringify(r.json), name).not.toContain(secret);
      expect(await orders(id), name).toBe(0);
    }
    const big = uid(); const huge = await post("a", big, labOrder(big, { address: "a".repeat(9000) })); expect(huge.status).toBe(413); expect(await orders(big)).toBe(0);
  });

  it("H2 el TMS rechaza la orden (fecha pasada, D07 pendiente): se acepta (202, idempotente), NO se vincula y el GET pide REVISIÓN con un código acotado, no «RECIBIDA» indefinida", async () => {
    const id = uid(); expect((await post("a", id, labOrder(id, { deliveryDate: "2020-01-01" }))).status).toBe(202);
    const g = await get("a", id); expect(g.status).toBe(200);
    expect(g.json).toMatchObject({ provisionalStatus: "RECEIVED", proposedStatus: "REVIEW_REQUIRED", confirmsDelivery: false, tms: { linked: false, linkIssue: { status: "BLOCKED", code: "REJECTED_BY_TMS" } } });
    expect(JSON.stringify(g.json)).not.toMatch(/anterior a hoy|fecha solicitada/i);   // nada del mensaje libre del TMS
    expect((await post("a", id, labOrder(id, { deliveryDate: "2020-01-01" }))).status).toBe(202);   // el reenvío idéntico sigue siendo idempotente
    expect(await ctx.count("SELECT COUNT(*) n FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id])).toBe(0);
  });
});

describe("API-24 matriz de estados REALES del TMS ↔ contrato externo propuesto (D08/D09, sin afirmar entrega)", () => {
  async function scheduled(): Promise<{ id: string; planId: number }> {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    let s = await solicitud(id); expect((await tomarEnRevisionSolicitud(A(), Number(s.id), Number(s.version), "ops.lab")).ok).toBe(true);
    s = await solicitud(id); const p = await programarSolicitud(A(), Number(s.id), Number(s.version), "ops.lab", perfilId); expect(p.ok, JSON.stringify(p)).toBe(true);
    return { id, planId: Number((await solicitud(id)).plan_id) };
  }
  const matrix: Array<[string, string, string]> = [   // [estado del plan, estado externo propuesto, veredicto de cancelación]
    ["Programado", "SCHEDULED", "OPERATIONS_MAY_CANCEL_PLAN"], ["Cargado", "LOADED", "OPERATIONS_MAY_CANCEL_PLAN"], ["En ruta", "IN_TRANSIT", "BLOCKED_IN_EXECUTION"],
    ["Descargado", "UNLOADED_UNCONFIRMED", "BLOCKED_COMPLETED"], ["Cerrado", "CLOSED_ADMINISTRATIVE", "BLOCKED_COMPLETED"], ["Cancelado", "CANCELLED", "ALREADY_CANCELLED"],
  ];
  for (const [plan, external, verdict] of matrix) {
    it(`H3 plan «${plan}» → ${external}; la cancelación pedida se evalúa «${verdict}», es solo constancia y NO cambia solicitud, plan ni se afirma entrega`, async () => {
      const { id, planId } = await scheduled();
      await ctx.db.query("UPDATE tms_planes_viaje SET estado = ? WHERE empresa_id = ? AND id = ?", [plan, A(), planId]);   // estado real del plan (laboratorio desechable)
      const g = await get("a", id); expect(g.json).toMatchObject({ proposedStatus: external, confirmsDelivery: false, tms: { requestState: "PROGRAMADA", scheduled: true } });
      expect(JSON.stringify(g.json)).not.toMatch(/DELIVERED|ENTREGAD/i);
      const c = await cancel("a", id); expect(c.status).toBe(202);
      expect((await get("a", id)).json).toMatchObject({ provisionalStatus: "CANCELLATION_REQUESTED", cancellation: { requested: true, automatic: false, assessment: verdict }, confirmsDelivery: false });
      const [p] = await ctx.rows("SELECT estado FROM tms_planes_viaje WHERE empresa_id = ? AND id = ?", [A(), planId]); expect(p.estado).toBe(plan);   // la cancelación no tocó el plan
      expect((await solicitud(id)).estado).toBe("PROGRAMADA");
    });
  }
  it("H4 Operaciones rechaza la solicitud antes de programarla → REJECTED; una cancelación posterior es «ya terminal» y no revive nada", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202);
    const s = await solicitud(id); const r = await rechazarSolicitud(A(), Number(s.id), Number(s.version), "Dirección no atendible (laboratorio)", "ops.lab"); expect(r.ok, JSON.stringify(r)).toBe(true);
    expect((await get("a", id)).json).toMatchObject({ proposedStatus: "REJECTED", confirmsDelivery: false, tms: { requestState: "RECHAZADA", scheduled: false } });
    expect((await cancel("a", id)).status).toBe(202);
    expect((await get("a", id)).json).toMatchObject({ proposedStatus: "REJECTED", cancellation: { requested: true, automatic: false, assessment: "ALREADY_TERMINAL" } });
    expect((await solicitud(id)).estado).toBe("RECHAZADA");
  });
  it("H5 solicitud y plan INCOHERENTES (plan sin estado conocido) → REVIEW_REQUIRED, nunca un estado inventado", async () => {
    const { id, planId } = await scheduled();
    await ctx.db.query("UPDATE tms_planes_viaje SET estado = 'Desconocido' WHERE empresa_id = ? AND id = ?", [A(), planId]);
    expect((await get("a", id)).json).toMatchObject({ proposedStatus: "REVIEW_REQUIRED", confirmsDelivery: false });
  });
});

describe("API-24 protección contra exposición de datos sensibles", () => {
  it("H6 respuestas (POST, GET, cancelación, errores) y registro de la app no contienen destinatario, dirección, notas, payload ni identificadores internos", async () => {
    const tag = uid(); const recipient = `Dest-${tag}`; const address = `Calle-${tag} 99-99`; const notes = `Nota-${tag}`;
    const id = uid(); const sent = labOrder(id, { recipient: { name: recipient }, address, notes });
    const responses = [await post("a", id, sent), await post("a", id, sent), await get("a", id), await cancel("a", id), await get("b", id),
      await post("a", uid(), { ...labOrder(uid()), recipient: { name: recipient }, address, extra: tag })];
    const text = JSON.stringify(responses.map((r) => r.json));
    for (const s of [recipient, address, notes, tag]) expect(text, s).not.toContain(s);
    const [o] = await ctx.rows("SELECT HEX(id) h FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ?", [A(), Buffer.from(id)]);
    expect(text.toLowerCase()).not.toContain(String(o.h).toLowerCase()); expect(text).not.toMatch(/payload|ciphertext|claim|lease|sandbox_api02|SELECT |INSERT /i);
    // La orden se guarda CIFRADA (la dirección no aparece en claro en la base) y el registro de la app no la imprime.
    expect(await ctx.count("SELECT COUNT(*) n FROM ps_api01_orders WHERE tenant_id = ? AND external_order_id = ? AND (payload_ciphertext LIKE ? OR payload_ciphertext LIKE ?)", [A(), Buffer.from(id), `%${address}%`, `%${recipient}%`])).toBe(0);
    const log = logText(); for (const s of [recipient, address, notes, tag]) expect(log, `registro de la app: ${s}`).not.toContain(s);
    // Auditoría de cancelación: referencia de la orden y solicitud, nunca destinatario ni dirección.
    const aud = await ctx.rows("SELECT detalle FROM auditoria WHERE accion = 'pricesmart_cancelacion_solicitada' AND detalle LIKE ?", [`%${id}%`]);
    for (const a of aud) for (const s of [recipient, address, notes]) expect(String(a.detalle)).not.toContain(s);
  });
});

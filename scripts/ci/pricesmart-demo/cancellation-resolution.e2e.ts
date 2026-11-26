// PRICESMART API-27 (cancelaciones, parte INTERNA) — contra la app real (`next dev`) y MariaDB 11.8.9 real y desechable, con datos ficticios. Independiente del método HTTP de cancelación (D09 pendiente):
//  · la solicitud de cancelación queda PENDING en el GET hasta que una PERSONA de Operaciones la resuelve (quién, cuándo, nota, auditoría en una sola transacción);
//  · EXECUTED solo si el TMS YA refleja la cancelación/rechazo; NOT_EXECUTED exige nota y protege viajes iniciados; nada se cancela automáticamente;
//  · idempotente y con concurrencia (una sola resolución gana; no se sobrescribe); aislado por empresa y por solicitud.
// Solo se ejecuta desde un arnés de laboratorio (run-linux.mjs).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "@/lib/db";
import { programarSolicitud, rechazarSolicitud, tomarEnRevisionSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";
import { resolveCancellation } from "../../../src/lib/integrations/pricesmart/lab-demo/cancellation-resolution";
import { cancel, connect, empresas, get, post, uid, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { ctx = await connect(); });
afterAll(async () => { await ctx.db.end(); });
const rows: typeof ctx.rows = (...a) => ctx.rows(...a);
const schema = String(process.env.DB_NAME); const pool = getPool();
const resolve = (solicitudId: number, resolution: "EXECUTED" | "NOT_EXECUTED", note?: string, empresaId = empresas.a.empresaId, usuario = "ops.lab") =>
  resolveCancellation({ pool, schema }, { empresaId, solicitudId, resolution, usuario, note });
const solicitudOf = async (id: string): Promise<Row> => { for (let i = 0; i < 40; i++) { const r = await rows("SELECT id, estado, plan_id, version FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, id]); if (r.length) return r[0]; await new Promise((x) => setTimeout(x, 250)); } throw new Error("la solicitud no se vinculó"); };
const linkRow = async (solicitudId: number) => (await rows("SELECT cancellation_requested_at, cancellation_resolution, cancellation_resolved_by, cancellation_resolved_at, cancellation_resolution_note FROM ps_api12_tms_links WHERE empresa_id = ? AND solicitud_id = ?", [empresas.a.empresaId, solicitudId]))[0];
const audits = async (solicitudId: number) => Number((await rows("SELECT COUNT(*) n FROM auditoria WHERE empresa_id = ? AND accion = 'pricesmart_cancelacion_resuelta' AND detalle LIKE ?", [empresas.a.empresaId, `%#${solicitudId}:%`]))[0].n);
async function pedida(): Promise<{ id: string; sol: Row }> { const id = uid(); expect((await post("a", id)).status).toBe(202); const sol = await solicitudOf(id); expect((await cancel("a", id)).status).toBe(202); return { id, sol }; }
async function programar(sol: Row) {
  const [perfil] = await ctx.db.query("INSERT INTO tms_cotizacion_costeo_perfiles (empresa_id, codigo, nombre, dias_operacion_mes, vida_util_aceite_km, vida_util_llantas_km, rendimiento_km_galon) VALUES (?, ?, 'Camión 5T ficticio', 26, 5000, 50000, 10)", [empresas.a.empresaId, `CR${uid()}`.slice(0, 20)]) as unknown as [{ insertId: number }];
  const t = await tomarEnRevisionSolicitud(empresas.a.empresaId, Number(sol.id), Number(sol.version), "ops.lab"); expect(t.ok).toBe(true);
  const [s2] = await rows("SELECT version FROM tms_solicitudes_cliente WHERE id = ?", [sol.id]); const p = await programarSolicitud(empresas.a.empresaId, Number(sol.id), Number(s2.version), "ops.lab", perfil.insertId); expect(p.ok, JSON.stringify(p)).toBe(true);
}

describe("Resolución de cancelaciones por Operaciones (API-27, parte interna)", () => {
  it("CR.1 la solicitud queda PENDING en el GET; EXECUTED se rechaza mientras el TMS no esté cancelado (STATE_CONFLICT) y no cambia nada; sin cancelación pedida no hay qué resolver", async () => {
    const { id, sol } = await pedida();
    expect((await get("a", id)).json).toMatchObject({ confirmsDelivery: false, cancellation: { requested: true, automatic: false, resolution: "PENDING" } });
    expect(await resolve(Number(sol.id), "EXECUTED")).toBe("STATE_CONFLICT");
    expect(await linkRow(Number(sol.id))).toMatchObject({ cancellation_resolution: null, cancellation_resolved_by: null, cancellation_resolved_at: null });
    expect(await audits(Number(sol.id))).toBe(0);
    const sinPedir = uid(); expect((await post("a", sinPedir)).status).toBe(202); const s2 = await solicitudOf(sinPedir);
    expect(await resolve(Number(s2.id), "NOT_EXECUTED", "no aplica")).toBe("NOT_REQUESTED");
  });
  it("CR.2 NOT_EXECUTED exige nota; al resolverse queda quién y cuándo, el GET lo refleja sin exponer la nota ni la persona, el TMS NO cambia y la auditoría es una sola; repetir no sobrescribe", async () => {
    const { id, sol } = await pedida(); const antes = await solicitudOf(id);
    expect(await resolve(Number(sol.id), "NOT_EXECUTED")).toBe("NOTE_REQUIRED"); expect(await resolve(Number(sol.id), "NOT_EXECUTED", " ")).toBe("NOTE_REQUIRED");
    expect(await resolve(Number(sol.id), "NOT_EXECUTED", "Ya se coordinó la entrega con el cliente")).toBe("RESOLVED");
    expect(await linkRow(Number(sol.id))).toMatchObject({ cancellation_resolution: "NOT_EXECUTED", cancellation_resolved_by: "ops.lab", cancellation_resolution_note: "Ya se coordinó la entrega con el cliente" });
    const g = (await get("a", id)).json; expect(g.cancellation).toEqual({ requested: true, automatic: false, assessment: expect.any(String), resolution: "NOT_EXECUTED" });
    expect(JSON.stringify(g)).not.toMatch(/ops\.lab|coordinó/);
    const despues = await solicitudOf(id); expect(despues).toMatchObject({ estado: antes.estado, plan_id: antes.plan_id });   // nada se canceló
    expect(await audits(Number(sol.id))).toBe(1);
    expect(await resolve(Number(sol.id), "NOT_EXECUTED", "otra nota", empresas.a.empresaId, "otro.usuario")).toBe("ALREADY_RESOLVED");
    expect(await linkRow(Number(sol.id))).toMatchObject({ cancellation_resolved_by: "ops.lab", cancellation_resolution_note: "Ya se coordinó la entrega con el cliente" });
    expect(await audits(Number(sol.id))).toBe(1);
  });
  it("CR.3 EXECUTED solo cuando el TMS YA refleja el rechazo/cancelación (Operaciones rechazó la solicitud antes de programar); entonces NOT_EXECUTED sería contradictorio", async () => {
    const { id, sol } = await pedida();
    const t = await tomarEnRevisionSolicitud(empresas.a.empresaId, Number(sol.id), Number(sol.version), "ops.lab"); expect(t.ok).toBe(true);
    const [v] = await rows("SELECT version FROM tms_solicitudes_cliente WHERE id = ?", [sol.id]);
    const r = await rechazarSolicitud(empresas.a.empresaId, Number(sol.id), Number(v.version), "Cancelación pedida por PriceSmart antes de programar", "ops.lab"); expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(await resolve(Number(sol.id), "NOT_EXECUTED", "no debería poder")).toBe("STATE_CONFLICT");
    expect(await resolve(Number(sol.id), "EXECUTED")).toBe("RESOLVED");
    expect((await get("a", id)).json).toMatchObject({ confirmsDelivery: false, cancellation: { resolution: "EXECUTED" } });
    expect(await linkRow(Number(sol.id))).toMatchObject({ cancellation_resolution: "EXECUTED", cancellation_resolved_by: "ops.lab" });
  });
  it("CR.4 un viaje INICIADO o descargado está protegido: la cancelación no se da por ejecutada (STATE_CONFLICT) y Operaciones solo puede resolverla como NO ejecutada, con nota; el viaje no cambia", async () => {
    for (const estado of ["En ruta", "Descargado"]) {
      const { id, sol } = await pedida(); await programar(sol); const s = await solicitudOf(id);
      await ctx.db.query("UPDATE tms_planes_viaje SET estado = ? WHERE empresa_id = ? AND id = ?", [estado, empresas.a.empresaId, s.plan_id]);
      expect((await get("a", id)).json).toMatchObject({ confirmsDelivery: false, cancellation: { assessment: estado === "En ruta" ? "BLOCKED_IN_EXECUTION" : "BLOCKED_COMPLETED", resolution: "PENDING" } });
      expect(await resolve(Number(s.id), "EXECUTED")).toBe("STATE_CONFLICT");
      expect(await resolve(Number(s.id), "NOT_EXECUTED", `viaje ${estado}`)).toBe("RESOLVED");
      const [plan] = await rows("SELECT estado FROM tms_planes_viaje WHERE empresa_id = ? AND id = ?", [empresas.a.empresaId, s.plan_id]); expect(plan.estado).toBe(estado);
    }
  });
  it("CR.5 concurrencia: 8 resoluciones simultáneas (mezcla de resultados) → exactamente UNA gana, el resto ALREADY_RESOLVED, una sola auditoría y la fila queda con la primera", async () => {
    const { sol } = await pedida();
    const out = await Promise.all(Array.from({ length: 8 }, (_, i) => resolve(Number(sol.id), "NOT_EXECUTED", `nota ${i}`, empresas.a.empresaId, `ops.${i}`)));
    expect(out.filter((x) => x === "RESOLVED")).toHaveLength(1); expect(out.filter((x) => x === "ALREADY_RESOLVED")).toHaveLength(7);
    expect(await audits(Number(sol.id))).toBe(1);
    const row = await linkRow(Number(sol.id)); expect(row.cancellation_resolved_by).toMatch(/^ops\.\d$/); expect(row.cancellation_resolution_note).toBe(`nota ${String(row.cancellation_resolved_by).slice(-1)}`);
  });
  it("CR.6 aislamiento: otra empresa no puede resolver (NOT_FOUND) y nada cambia; entradas inválidas se rechazan sin tocar la base; el CHECK de la tabla impide estados incoherentes", async () => {
    const { sol } = await pedida();
    expect(await resolve(Number(sol.id), "NOT_EXECUTED", "intento ajeno", empresas.b.empresaId)).toBe("NOT_FOUND");
    expect(await resolve(0, "NOT_EXECUTED", "x".repeat(5))).toBe("INVALID"); expect(await resolve(Number(sol.id), "BORRAR" as never, "nota")).toBe("INVALID"); expect(await resolve(Number(sol.id), "NOT_EXECUTED", "n".repeat(301))).toBe("INVALID");
    expect(await resolve(Number(sol.id), "NOT_EXECUTED", "nota válida", empresas.a.empresaId, "  ")).toBe("INVALID");
    expect(await linkRow(Number(sol.id))).toMatchObject({ cancellation_resolution: null });
    await expect(ctx.db.query("UPDATE ps_api12_tms_links SET cancellation_resolution = 'EXECUTED' WHERE empresa_id = ? AND solicitud_id = ?", [empresas.a.empresaId, sol.id])).rejects.toMatchObject({ code: expect.stringMatching(/ER_CONSTRAINT_FAILED|4025/) });
  });
});

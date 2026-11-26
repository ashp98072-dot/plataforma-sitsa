// PRICESMART KPI — capa de consulta/exportación (src/lib/integrations/pricesmart/kpi) contra la app real (`next dev`) y MariaDB 11.8.9 real y desechable, con datos ficticios.
// Verifica con datos reales: orden/club, fecha planificada, salida, evidencia de entrega y cumplimiento SOLO cuando los datos lo permiten; ventana e ítems NO_DISPONIBLE; sin entrega confirmada (D13);
// aislamiento por empresa y cliente; órdenes sin vincular fuera; exportación CSV sin datos personales del destinatario. Solo se ejecuta desde un arnés de laboratorio (run-linux.mjs).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { programarSolicitud, tomarEnRevisionSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";
import { kpiToCsv, KPI_CSV_COLUMNS } from "../../../src/lib/integrations/pricesmart/kpi/kpi-model";
import { loadKpiRows, type KpiQuery } from "../../../src/lib/integrations/pricesmart/kpi/kpi-source";
import { connect, day, empresas, get, labOrder, post, uid, type Row } from "./e2e-support";

let ctx: Awaited<ReturnType<typeof connect>>; let perfilId = 0;
const schema = String(process.env.DB_NAME);
const q: KpiQuery = async (sql, params) => (await ctx.db.query(sql, params))[0] as Row[];
beforeAll(async () => {
  ctx = await connect();
  perfilId = Number(((await ctx.db.query("INSERT INTO tms_cotizacion_costeo_perfiles (empresa_id, codigo, nombre, dias_operacion_mes, vida_util_aceite_km, vida_util_llantas_km, rendimiento_km_galon) VALUES (?, ?, 'Camión 5T ficticio', 26, 5000, 50000, 10)", [empresas.a.empresaId, `KP${uid()}`.slice(0, 20)])) as unknown as [{ insertId: number }])[0].insertId);
});
afterAll(async () => { await ctx.db.end(); });
const A = () => empresas.a.empresaId;
const solicitud = async (id: string): Promise<Row> => { for (let i = 0; i < 40; i++) { const r = await ctx.rows("SELECT id, estado, plan_id, version FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [A(), id]); if (r.length) return r[0]; await new Promise((x) => setTimeout(x, 250)); } throw new Error("sin solicitud"); };
async function orden(deliveryDate = day(3), programar = false) {
  const id = uid(); expect((await post("a", id, labOrder(id, { deliveryDate }))).status).toBe(202); let s = await solicitud(id);
  if (programar) { expect((await tomarEnRevisionSolicitud(A(), Number(s.id), Number(s.version), "ops.lab")).ok).toBe(true); s = await solicitud(id); const p = await programarSolicitud(A(), Number(s.id), Number(s.version), "ops.lab", perfilId); expect(p.ok, JSON.stringify(p)).toBe(true); s = await solicitud(id); }
  return { id, s };
}
const fila = async (id: string, f: { clienteId?: number } = {}) => (await loadKpiRows(q, { empresaId: A(), ...f }, schema)).find((r) => r.numeroOrden === id);
const entregaStop = async (planId: unknown) => (await ctx.rows("SELECT id, tipo, orden, lugar_nombre FROM tms_plan_paradas WHERE plan_id = ? AND tipo = 'Entrega' ORDER BY orden", [planId]))[0];
async function confirmar(planId: unknown, stop: Row, resultado: string, confirmadoEn: string) {
  const ok = resultado === "ENTREGADA_POR_PILOTO";
  await ctx.db.query("INSERT INTO tms_parada_confirmaciones (empresa_id, plan_id, viaje_id, parada_id, parada_tipo, parada_orden, parada_lugar_nombre, resultado, revision, entrega_vigente, piloto_empleado_id, piloto_personal_id, piloto_usuario, evidencia_id, evidencia_ruta, nota, confirmado_en) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'piloto.lab', 7, 'lab/evidencia.jpg', ?, ?)",
    [A(), planId, stop.id, stop.tipo, stop.orden, stop.lugar_nombre, resultado, ok ? "NO_REQUERIDA" : "PENDIENTE", ok ? 1 : null, ok ? null : "Nota de revisión ficticia", confirmadoEn]);
}

describe("KPI sobre datos reales de SITSA (MariaDB 11.8.9)", () => {
  it("K.1 orden recibida sin programar: número y club reales; lo demás SIN_DATO/NO_DISPONIBLE; sin cumplimiento ni entrega; el GET de la API sigue sin confirmar entrega", async () => {
    const { id } = await orden(); const r = (await fila(id))!;
    expect(r).toMatchObject({ numeroOrden: id, club: "QA-CLUB", fechaPlanificada: null, ventanaEntrega: null, salidaEn: null, entregaEvidenciadaEn: null, entregaNivelEvidencia: "NO_PROGRAMADA", estadoServicio: "SOLICITADA", cantidadItems: null, cumplimientoEntrega: "NO_CALCULABLE", confirmaEntrega: false });
    expect(r.disponibilidad).toMatchObject({ ventanaEntrega: "NO_DISPONIBLE", cantidadItems: "NO_DISPONIBLE", fechaPlanificada: "SIN_DATO" });
    expect((await get("a", id)).json).toMatchObject({ confirmsDelivery: false });
  });
  it("K.2 programada, en ruta, con salida del piloto y SIN confirmaciones: fecha planificada y salida reales; Descargado/Cerrado NO generan entrega ni cumplimiento", async () => {
    const { id, s } = await orden(day(4), true); const plan = (await ctx.rows("SELECT fecha_plan, codigo FROM tms_planes_viaje WHERE empresa_id = ? AND id = ?", [A(), s.plan_id]))[0];
    let r = (await fila(id))!; expect(r).toMatchObject({ estadoServicio: "Programado", entregaNivelEvidencia: "NONE", salidaEn: null, cumplimientoEntrega: "NO_CALCULABLE" }); expect(r.fechaPlanificada).toBe(String(plan.fecha_plan instanceof Date ? `${plan.fecha_plan.getFullYear()}-${String(plan.fecha_plan.getMonth() + 1).padStart(2, "0")}-${String(plan.fecha_plan.getDate()).padStart(2, "0")}` : plan.fecha_plan).slice(0, 10));
    const [veh] = await ctx.db.query("INSERT INTO flota_vehiculos (empresa_id, placa) VALUES (?, ?)", [A(), `K${uid().slice(2, 8)}`.toUpperCase()]) as unknown as [{ insertId: number }];
    await ctx.db.query("INSERT INTO flota_viajes (empresa_id, vehiculo_id, piloto_nombre, hora_salida, estado, plan_id) VALUES (?, ?, 'Piloto ficticio', '2030-01-14 06:42:10', 'abierto', ?)", [A(), veh.insertId, s.plan_id]);
    for (const estado of ["En ruta", "Descargado", "Cerrado"]) { await ctx.db.query("UPDATE tms_planes_viaje SET estado = ? WHERE empresa_id = ? AND id = ?", [estado, A(), s.plan_id]); r = (await fila(id))!;
      expect(r, estado).toMatchObject({ estadoServicio: estado, salidaEn: "2030-01-14 06:42:10", entregaEvidenciadaEn: null, cumplimientoEntrega: "NO_CALCULABLE", confirmaEntrega: false }); }
    expect((await get("a", id)).json).toMatchObject({ confirmsDelivery: false });
  });
  it("K.3 evidencia de entrega del piloto: la hora es la del evento y el cumplimiento se calcula por día (a tiempo / tarde); incidencia pendiente de revisión → sin entrega ni cumplimiento", async () => {
    const aTiempo = await orden(day(5), true); const tarde = await orden(day(5), true); const inc = await orden(day(5), true);
    await confirmar(aTiempo.s.plan_id, await entregaStop(aTiempo.s.plan_id), "ENTREGADA_POR_PILOTO", `${day(5)} 10:15:00`);
    await confirmar(tarde.s.plan_id, await entregaStop(tarde.s.plan_id), "ENTREGADA_POR_PILOTO", `${day(6)} 08:00:00`);
    await confirmar(inc.s.plan_id, await entregaStop(inc.s.plan_id), "INCIDENCIA", `${day(5)} 09:00:00`);
    expect((await fila(aTiempo.id))!).toMatchObject({ entregaNivelEvidencia: "PILOT_CONFIRMED_ALL", entregaEvidenciadaEn: `${day(5)} 10:15:00`, cumplimientoEntrega: "A_TIEMPO", cumplimientoBase: "FECHA_DIA", confirmaEntrega: false });
    expect((await fila(tarde.id))!).toMatchObject({ entregaEvidenciadaEn: `${day(6)} 08:00:00`, cumplimientoEntrega: "TARDE" });
    expect((await fila(inc.id))!).toMatchObject({ entregaNivelEvidencia: "REVIEW_REQUIRED", entregaEvidenciadaEn: null, cumplimientoEntrega: "NO_CALCULABLE" });
    for (const x of [aTiempo, tarde]) expect((await get("a", x.id)).json).toMatchObject({ confirmsDelivery: false });   // la API sigue sin afirmar entrega (D13)
  });
  it("K.4 aislamiento y alcance: otra empresa y otro cliente no ven la orden; una orden NO vinculada con el TMS no aparece; el límite de filas se respeta", async () => {
    const { id, s } = await orden();
    expect((await loadKpiRows(q, { empresaId: empresas.b.empresaId }, schema)).some((r) => r.numeroOrden === id)).toBe(false);
    expect(await fila(id, { clienteId: empresas.a.clienteId + 999 })).toBeUndefined(); expect(await fila(id, { clienteId: Number((await ctx.rows("SELECT cliente_id FROM tms_solicitudes_cliente WHERE id = ?", [s.id]))[0].cliente_id) })).toBeDefined();
    const huerfana = uid(); await ctx.db.query("INSERT INTO tms_solicitudes_cliente (empresa_id, cliente_id, creado_por_usuario_cliente_id, estado, fecha_solicitada, referencia_cliente, version) SELECT empresa_id, cliente_id, creado_por_usuario_cliente_id, 'SOLICITADA', fecha_solicitada, ?, 1 FROM tms_solicitudes_cliente WHERE id = ?", [huerfana, s.id]);
    expect(await fila(huerfana)).toBeUndefined();   // una solicitud del mismo cliente que NO nació de PriceSmart (sin vínculo) no es parte del KPI
    expect(await loadKpiRows(q, { empresaId: A(), limite: 2 }, schema)).toHaveLength(2);
  });
  it("K.5 exportación CSV: columnas fijas, NO_DISPONIBLE para ventana e ítems, confirma_entrega=false y SIN datos personales del destinatario (nombre ni dirección)", async () => {
    const { id } = await orden(); const csv = kpiToCsv((await loadKpiRows(q, { empresaId: A() }, schema)).filter((r) => r.numeroOrden === id));
    const [head, line] = csv.split("\n"); expect(head).toBe(KPI_CSV_COLUMNS.join(",")); const cells = line.split(",");
    expect(cells[0]).toBe(id); expect(cells[KPI_CSV_COLUMNS.indexOf("ventana_entrega")]).toBe("NO_DISPONIBLE"); expect(cells[KPI_CSV_COLUMNS.indexOf("cantidad_items")]).toBe("NO_DISPONIBLE"); expect(cells.at(-1)).toBe("false");
    expect(csv).not.toMatch(/Club Ficticio Zona 10|Avenida Ficticia|\[PS:/);
  });
});

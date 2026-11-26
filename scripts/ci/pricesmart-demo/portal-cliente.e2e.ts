// PRICESMART — Portal del Cliente existente (`/api/cliente-portal/**`) contra la app real (`next dev`) y MariaDB 11.8.9 real y desechable, con datos ficticios y sesiones reales (login HTTP):
//  · las órdenes recibidas por la API de PriceSmart (solicitudes creadas por la integración) se ven en el portal del cliente MAPEADO, sin duplicarse, con estado, viaje, paradas y evidencias;
//  · otro cliente de la misma empresa y otra empresa NO las ven (404); evidencias solo de SU orden;
//  · una cuenta de SOLO CONSULTA no puede crear solicitudes (403) pero sí consultar; una cuenta normal sigue pudiendo;
//  · el portal no confirma entrega: el estado «Finalizado» del viaje coexiste con `confirmsDelivery:false` del GET de la API.
// No crea cuentas reales: solo usuarios ficticios en la base desechable. Solo se ejecuta desde un arnés de laboratorio (run-linux.mjs).
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crearUsuarioCliente } from "@/lib/tms/cliente-usuarios";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import { programarSolicitud, tomarEnRevisionSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";
import { BASE, connect, day, empresas, get, post, uid, type Row } from "./e2e-support";

const PASS = "Temporal-123";
let ctx: Awaited<ReturnType<typeof connect>>;
const cookies: Record<"consulta" | "normal" | "otroCliente" | "otraEmpresa", string> = { consulta: "", normal: "", otroCliente: "", otraEmpresa: "" };
let otroClienteId = 0;
const rows: typeof ctx.rows = (...a) => ctx.rows(...a);

async function usuario(empresaId: number, clienteId: number, nombre: string, soloLectura: boolean): Promise<string> {
  const email = `${nombre.toLowerCase().replace(/\W+/g, "-")}-${randomBytes(3).toString("hex")}@lab.invalid`;
  const r = await crearUsuarioCliente({ empresaId, clienteId, nombre, email, passwordInicial: PASS, creadoPor: "e2e", soloLectura }); expect(r.ok, JSON.stringify(r)).toBe(true);
  const res = await fetch(`${BASE}/api/cliente-portal/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASS }) });
  expect(res.status).toBe(200); const c = res.headers.get("set-cookie")?.match(/sitsa_cliente_session=[^;]+/)?.[0]; expect(c).toBeTruthy(); return c!;
}
const portal = async (who: keyof typeof cookies, path: string, init: RequestInit = {}) => {
  const res = await fetch(`${BASE}/api/cliente-portal${path}`, { ...init, headers: { ...(init.headers ?? {}), Cookie: cookies[who], ...(init.body ? { "Content-Type": "application/json" } : {}) } });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Row };
};
const solicitudOf = async (id: string): Promise<Row> => { for (let i = 0; i < 40; i++) { const r = await rows("SELECT id, estado, plan_id, version FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, id]); if (r.length) return r[0]; await new Promise((x) => setTimeout(x, 250)); } throw new Error("la solicitud no se vinculó"); };
async function programar(sol: Row) {
  const [perfil] = await ctx.db.query("INSERT INTO tms_cotizacion_costeo_perfiles (empresa_id, codigo, nombre, dias_operacion_mes, vida_util_aceite_km, vida_util_llantas_km, rendimiento_km_galon) VALUES (?, ?, 'Camión 5T ficticio', 26, 5000, 50000, 10)", [empresas.a.empresaId, `CP${uid()}`.slice(0, 20)]) as unknown as [{ insertId: number }];
  expect((await tomarEnRevisionSolicitud(empresas.a.empresaId, Number(sol.id), Number(sol.version), "ops.lab")).ok).toBe(true);
  const [s2] = await rows("SELECT version FROM tms_solicitudes_cliente WHERE id = ?", [sol.id]);
  const p = await programarSolicitud(empresas.a.empresaId, Number(sol.id), Number(s2.version), "ops.lab", perfil.insertId); expect(p.ok, JSON.stringify(p)).toBe(true);
}

beforeAll(async () => {
  ctx = await connect(); await asegurarSchemaFlota();
  otroClienteId = Number((await ctx.db.query("INSERT INTO tms_clientes (empresa_id, nombre) VALUES (?, 'Otro cliente ficticio de la misma empresa')", [empresas.a.empresaId]) as unknown as [{ insertId: number }])[0].insertId);
  cookies.consulta = await usuario(empresas.a.empresaId, empresas.a.clienteId, "Consulta PriceSmart", true);
  cookies.normal = await usuario(empresas.a.empresaId, empresas.a.clienteId, "Operador normal", false);
  cookies.otroCliente = await usuario(empresas.a.empresaId, otroClienteId, "Otro cliente", false);
  cookies.otraEmpresa = await usuario(empresas.b.empresaId, empresas.b.clienteId, "Otra empresa", true);
});
afterAll(async () => { await ctx.db.end(); });

describe("Portal del Cliente — consulta de órdenes recibidas por la integración", () => {
  it("CP.1 la orden de PriceSmart aparece UNA vez en el portal del cliente mapeado (con su referencia y estado) y NO la ven otro cliente ni otra empresa (lista y detalle → 404)", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202); const sol = await solicitudOf(id);
    const lista = await portal("consulta", "/solicitudes"); expect(lista.status).toBe(200);
    expect((lista.json.solicitudes as Row[]).filter((s) => s.referenciaCliente === id)).toEqual([expect.objectContaining({ id: Number(sol.id), estado: "SOLICITADA", planId: null })]);   // una sola vez, sin duplicar datos
    expect((await portal("normal", "/solicitudes")).json.solicitudes.some((s: Row) => s.referenciaCliente === id)).toBe(true);   // todas las cuentas del MISMO cliente la ven
    const det = await portal("consulta", `/solicitudes/${sol.id}`); expect(det.status).toBe(200); expect(JSON.stringify(det.json)).toContain(id);
    for (const quien of ["otroCliente", "otraEmpresa"] as const) {
      expect((await portal(quien, "/solicitudes")).json.solicitudes.some((s: Row) => s.referenciaCliente === id), quien).toBe(false);
      expect((await portal(quien, `/solicitudes/${sol.id}`)).status, quien).toBe(404); expect((await portal(quien, `/solicitudes/${sol.id}/seguimiento`)).status, quien).toBe(404);
    }
    expect((await fetch(`${BASE}/api/cliente-portal/solicitudes`)).status).toBe(401);   // sin sesión
  });
  it("CP.2 programación y viaje: el portal muestra el viaje y sus paradas; en ruta y descargado el estado coincide con la API (UNLOADED_UNCONFIRMED) y NINGUNO confirma entrega", async () => {
    const id = uid(); expect((await post("a", id)).status).toBe(202); const sol = await solicitudOf(id); await programar(sol); const s = await solicitudOf(id);
    let seg = await portal("consulta", `/solicitudes/${sol.id}/seguimiento`); expect(seg.status).toBe(200);
    expect(seg.json.plan).toMatchObject({ estadoPortal: "PROGRAMADO", estadoReal: "Programado" }); expect((seg.json.plan.paradas as Row[]).map((p) => p.tipo)).toEqual(["Carga", "Entrega", "Descarga"]);
    expect((seg.json.plan.paradas as Row[]).every((p) => p.completada === false && p.cantidadEvidencias === 0)).toBe(true);
    for (const [estado, portalEstado, apiEstado] of [["En ruta", "EN_RUTA", "IN_TRANSIT"], ["Descargado", "FINALIZADO", "UNLOADED_UNCONFIRMED"]] as const) {
      await ctx.db.query("UPDATE tms_planes_viaje SET estado = ? WHERE empresa_id = ? AND id = ?", [estado, empresas.a.empresaId, s.plan_id]);
      seg = await portal("consulta", `/solicitudes/${sol.id}/seguimiento`); expect(seg.json.plan).toMatchObject({ estadoPortal: portalEstado });
      expect((await get("a", id)).json).toMatchObject({ proposedStatus: apiEstado, confirmsDelivery: false });   // «Finalizado» del portal ≠ entrega confirmada
    }
    expect((await portal("otroCliente", `/solicitudes/${sol.id}/seguimiento`)).status).toBe(404);
  });
  it("CP.3 evidencias: el portal lista SOLO las de la parada de ESA orden (sin exponer la ruta del archivo); otra orden, otro cliente y otra empresa no las alcanzan; el conteo coincide", async () => {
    const mk = async () => { const id = uid(); expect((await post("a", id)).status).toBe(202); const sol = await solicitudOf(id); await programar(sol); const s = await solicitudOf(id);
      const paradas = await rows("SELECT id, tipo FROM tms_plan_paradas WHERE plan_id = ? ORDER BY orden", [s.plan_id]); return { id, sol: s, entrega: paradas.find((p) => p.tipo === "Entrega")! }; };
    const a = await mk(); const b = await mk();
    const [veh] = await ctx.db.query("INSERT INTO flota_vehiculos (empresa_id, placa) VALUES (?, ?)", [empresas.a.empresaId, `P${randomBytes(3).toString("hex")}`.toUpperCase().slice(0, 8)]) as unknown as [{ insertId: number }];
    const viaje = async (planId: unknown) => Number(((await ctx.db.query("INSERT INTO flota_viajes (empresa_id, vehiculo_id, piloto_nombre, hora_salida, estado, plan_id) VALUES (?, ?, 'Piloto ficticio', NOW(), 'abierto', ?)", [empresas.a.empresaId, veh.insertId, planId])) as unknown as [{ insertId: number }])[0].insertId);
    const evid = async (viajeId: number, paradaId: unknown, nombre: string) => Number(((await ctx.db.query("INSERT INTO flota_viaje_evidencias (empresa_id, viaje_id, tipo, ruta_relativa, nombre_original, mime, tamano, capturado_en, subido_por, creado_at, parada_id) VALUES (?, ?, 'producto', ?, ?, 'image/jpeg', 10, NOW(), 'piloto.lab', NOW(), ?)", [empresas.a.empresaId, viajeId, `lab/${nombre}`, nombre, paradaId])) as unknown as [{ insertId: number }])[0].insertId);
    const va = await viaje(a.sol.plan_id); const vb = await viaje(b.sol.plan_id);
    const ea = await evid(va, a.entrega.id, "entrega-a.jpg"); const eb = await evid(vb, b.entrega.id, "entrega-b.jpg");
    const lista = await portal("consulta", `/solicitudes/${a.sol.id}/paradas/${a.entrega.id}/evidencias`); expect(lista.status).toBe(200);
    expect(lista.json.evidencias).toEqual([expect.objectContaining({ id: ea, nombreOriginal: "entrega-a.jpg", tipo: "producto" })]); expect(JSON.stringify(lista.json)).not.toMatch(/ruta|lab\//);
    expect(JSON.stringify(lista.json)).not.toContain("entrega-b.jpg");   // la evidencia de la OTRA orden no aparece
    const seg = await portal("consulta", `/solicitudes/${a.sol.id}/seguimiento`); expect((seg.json.plan.paradas as Row[]).find((p) => p.id === a.entrega.id)).toMatchObject({ completada: true, cantidadEvidencias: 1 });
    // cruce de órdenes: la parada de B con la solicitud de A (y la evidencia de B por la parada de A) no existen
    expect((await portal("consulta", `/solicitudes/${a.sol.id}/paradas/${b.entrega.id}/evidencias`)).status).toBe(404);
    expect((await portal("consulta", `/solicitudes/${a.sol.id}/paradas/${a.entrega.id}/evidencias/${eb}/archivo`)).status).toBe(404);
    for (const quien of ["otroCliente", "otraEmpresa"] as const) { expect((await portal(quien, `/solicitudes/${a.sol.id}/paradas/${a.entrega.id}/evidencias`)).status, quien).toBe(404); expect((await portal(quien, `/solicitudes/${a.sol.id}/paradas/${a.entrega.id}/evidencias/${ea}/archivo`)).status, quien).toBe(404); }
  });
  it("CP.4 acceso de SOLO CONSULTA: la cuenta marcada no crea solicitudes (403, nada se escribe) pero consulta; la cuenta normal del mismo cliente sí crea; sin sesión → 401", async () => {
    const cuerpo = (ref: string) => ({ fechaSolicitada: day(5), referenciaCliente: ref, origen: { lugarNombre: "Bodega ficticia" }, entregas: [{ lugarNombre: "Sucursal ficticia" }], destino: { lugarNombre: "Destino ficticio" } });
    const ref = `CP${randomBytes(3).toString("hex")}`;
    const bloqueada = await portal("consulta", "/solicitudes", { method: "POST", body: JSON.stringify(cuerpo(ref)) }); expect(bloqueada.status).toBe(403); expect(bloqueada.json.error).toBe("Tu acceso es de solo consulta.");
    expect(await rows("SELECT id FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, ref])).toHaveLength(0);
    expect((await portal("consulta", "/solicitudes")).status).toBe(200);
    const ok = await portal("normal", "/solicitudes", { method: "POST", body: JSON.stringify(cuerpo(ref)) }); expect([200, 201]).toContain(ok.status);
    expect(await rows("SELECT id FROM tms_solicitudes_cliente WHERE empresa_id = ? AND referencia_cliente = ?", [empresas.a.empresaId, ref])).toHaveLength(1);
    expect((await fetch(`${BASE}/api/cliente-portal/solicitudes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo(ref)) })).status).toBe(401);
    // la marca se lee de la fila real: al quitarla, la cuenta puede crear; al ponerla de nuevo, vuelve a bloquearse (sin reiniciar sesión)
    await ctx.db.query("UPDATE tms_cliente_usuarios SET solo_lectura = 0 WHERE empresa_id = ? AND nombre = 'Consulta PriceSmart'", [empresas.a.empresaId]);
    expect([200, 201]).toContain((await portal("consulta", "/solicitudes", { method: "POST", body: JSON.stringify(cuerpo(`${ref}b`)) })).status);
    await ctx.db.query("UPDATE tms_cliente_usuarios SET solo_lectura = 1 WHERE empresa_id = ? AND nombre = 'Consulta PriceSmart'", [empresas.a.empresaId]);
    expect((await portal("consulta", "/solicitudes", { method: "POST", body: JSON.stringify(cuerpo(`${ref}c`)) })).status).toBe(403);
  });
});

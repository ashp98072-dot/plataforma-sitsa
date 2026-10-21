import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ guard: vi.fn(), documentos: vi.fn(), cobros: vi.fn(), cobrar: vi.fn(), bitacora: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantCxc: m.guard }));
vi.mock("./cxc", () => ({ listarDocumentosCxc: m.documentos, listarCobrosCxc: m.cobros, registrarCobroCxc: m.cobrar, listarBitacoraCxcLibro: m.bitacora }));
import { listarBitacoraHttp, listarCobrosHttp, listarDocumentosHttp, registrarCobroHttp } from "./http";

const OK = { empresa: { id: 7 }, session: { id: 91, username: "conta", rol: "Contabilidad" } };
const prohibido = () => ({ error: new Response(JSON.stringify({ error: "x" }), { status: 403 }) });
const get = (url = "http://l/x?entidad=1") => new Request(url);
const post = (body: unknown, url = "http://l/x?entidad=1") => new Request(url, { method: "POST", body: JSON.stringify(body) });
const cuerpo = { facturaId: 5, fechaPago: "2026-10-05", monto: 100, medioPago: "Transferencia", referencia: "R1" };
beforeEach(() => {
  vi.resetAllMocks();
  m.guard.mockResolvedValue(OK);
  m.documentos.mockResolvedValue({ filas: [], totalReal: 0, page: 1, pageSize: 25, porEntidad: [], rotulo: "x" });
  m.cobros.mockResolvedValue({ cobros: [], totalReal: 0, totalCobrado: "0.00", page: 1, pageSize: 25 });
  m.cobrar.mockResolvedValue({ ok: true });
  m.bitacora.mockResolvedValue({ eventos: [], totalReal: 0, page: 1, pageSize: 25 });
});

describe("permisos de los endpoints de CxC (fila + acción, fail-closed)", () => {
  it.each([
    ["documentos", () => listarDocumentosHttp(get(), "e"), ["cxc_cuentas", "ver"]],
    ["cobros (lista)", () => listarCobrosHttp(get(), "e"), ["cxc_cuentas", "ver"]],
    ["registrar cobro", () => registrarCobroHttp(post(cuerpo), "e"), ["cxc_cobros", "editar"]],
    ["bitácora", () => listarBitacoraHttp(get(), "e"), ["cxc_bitacora", "ver"]],
  ] as const)("%s exige %j y no ejecuta sin permiso", async (_n, llamar, [fila, accion]) => {
    m.guard.mockResolvedValue(prohibido());
    expect((await llamar()).status).toBe(403);
    expect(m.guard.mock.calls[0].slice(1, 3)).toEqual([fila, accion]);
    for (const f of [m.documentos, m.cobros, m.cobrar, m.bitacora]) expect(f).not.toHaveBeenCalled();
  });
  it("ningún endpoint de CxC usa el guard de Facturación ni el de módulo Contabilidad", () => {
    const src = readFileSync("src/lib/contabilidad/cxc/http.ts", "utf8");
    expect(src).not.toMatch(/requireTenantFacturacion|requireTenantModulo|requireTenantCxp/);
  });
});

describe("ámbito y entradas", () => {
  it("la entidad es obligatoria y única (?entidad=): sin ella 400 y no se consulta nada", async () => {
    expect((await listarDocumentosHttp(get("http://l/x"), "e")).status).toBe(400);
    expect((await listarDocumentosHttp(get("http://l/x?entidad=1&entidad=2"), "e")).status).toBe(400);
    expect((await listarCobrosHttp(get("http://l/x?entidad=abc"), "e")).status).toBe(400);
    expect((await registrarCobroHttp(post(cuerpo, "http://l/x"), "e")).status).toBe(400);
    for (const f of [m.documentos, m.cobros, m.cobrar]) expect(f).not.toHaveBeenCalled();
  });
  it("empresa y entidad salen de la sesión/?entidad=, nunca del cuerpo; el cobro lleva usuario de la sesión", async () => {
    const r = await registrarCobroHttp(post({ ...cuerpo, empresaId: 99, entidadId: 99, usuarioId: 1, registradoPor: 1 }), "e");
    expect(r.status).toBe(201);
    const [actor, entidadId, entrada] = m.cobrar.mock.calls[0];
    expect(actor).toEqual({ empresaId: 7, usuarioId: 91, usuario: "conta" });
    expect(entidadId).toBe(1);
    expect(Object.keys(entrada).sort()).toEqual(["facturaId", "fechaPago", "medioPago", "monto", "referencia"]);
  });
  it("los documentos se piden a la empresa de la sesión y al libro del query; el filtro de entidad del cliente no se pasa como entidad", async () => {
    await listarDocumentosHttp(get("http://l/x?entidad=2&alcance=pagadas&textoCliente=alfa&entidadFiltro=1"), "e");
    const [empresaId, entidadId, filtros] = m.documentos.mock.calls[0];
    expect([empresaId, entidadId]).toEqual([7, 2]);
    expect(filtros).toMatchObject({ alcance: "pagadas", textoCliente: "alfa" });
  });
  it("cobro inválido (monto ≤ 0, fecha mala, factura mala, cuerpo no JSON) → 400 sin servicio", async () => {
    for (const malo of [{ ...cuerpo, monto: 0 }, { ...cuerpo, monto: -1 }, { ...cuerpo, monto: "100" }, { ...cuerpo, fechaPago: "5/10/2026" }, { ...cuerpo, facturaId: 0 }, null, [1]]) {
      expect((await registrarCobroHttp(post(malo), "e")).status).toBe(400);
    }
    expect((await registrarCobroHttp(new Request("http://l/x?entidad=1", { method: "POST", body: "no-json" }), "e")).status).toBe(400);
    expect(m.cobrar).not.toHaveBeenCalled();
  });
  it("el sobrepago y los demás rechazos del servicio conservan su estado (409/404); fallos inesperados = 500 genérico", async () => {
    m.cobrar.mockResolvedValueOnce({ ok: false, error: "El pago (Q700) excede el saldo pendiente (Q600).", status: 409 });
    const r = await registrarCobroHttp(post({ ...cuerpo, monto: 700 }), "e");
    expect(r.status).toBe(409); expect(await r.json()).toEqual({ error: "El pago (Q700) excede el saldo pendiente (Q600)." });
    m.cobrar.mockResolvedValueOnce({ ok: false, error: "Factura no encontrada en este libro contable.", status: 404 });
    expect((await registrarCobroHttp(post(cuerpo), "e")).status).toBe(404);
    m.documentos.mockRejectedValueOnce(new Error("SELECT secreto FROM x"));
    const e500 = await listarDocumentosHttp(get(), "e");
    expect(e500.status).toBe(500); expect(JSON.stringify(await e500.json())).not.toContain("secreto");
  });
  it("bitácora: empresa de la sesión + libro del query; la entidad es obligatoria; filtros validados", async () => {
    expect((await listarBitacoraHttp(get("http://l/x"), "e")).status).toBe(400);
    await listarBitacoraHttp(get("http://l/x?entidad=2&accion=registrar_pago&usuario=ana&facturaId=5&fechaDesde=2026-10-01&empresaId=99"), "e");
    const [empresaId, entidadId, filtros] = m.bitacora.mock.calls[0];
    expect([empresaId, entidadId]).toEqual([7, 2]);
    expect(filtros).toMatchObject({ accion: "registrar_pago", usuario: "ana", facturaId: 5, fechaDesde: "2026-10-01" });
    await listarBitacoraHttp(get("http://l/x?entidad=2&accion=borrar_todo&fechaDesde=ayer"), "e");
    expect(m.bitacora.mock.calls[1][2]).toMatchObject({ accion: undefined, fechaDesde: undefined });
  });
  it("las respuestas no se cachean", async () => {
    expect((await listarDocumentosHttp(get(), "e")).headers.get("Cache-Control")).toBe("private, no-store");
  });
});

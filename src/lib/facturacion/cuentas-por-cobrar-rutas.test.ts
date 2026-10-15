import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  verOk: true,
  listar: vi.fn(),
  clientes: vi.fn(),
  resumen: vi.fn(),
  pagos: vi.fn(),
  confirmaciones: vi.fn(),
  exportar: vi.fn(),
  entidades: vi.fn(),
}));

vi.mock("@/lib/tenant", () => ({
  requireTenantFacturacion: vi.fn(async (_slug: string, accion: string) => {
    if (accion !== "ver") throw new Error("M-2a solo lee: debe pedir 'ver'");
    return m.verOk
      ? { session: { id: 11, username: "ana", rol: "Contabilidad" }, empresa: { id: 7 } }
      : { error: NextResponse.json({ error: "Sin permiso para ver Facturación." }, { status: 403 }) };
  }),
}));
vi.mock("@/lib/facturacion/cuentas-por-cobrar", () => ({
  listarCuentasPorCobrar: m.listar,
  listarClientesCxc: m.clientes,
  resumenCliente: m.resumen,
  listarPagosCliente: m.pagos,
  listarConfirmacionesCliente: m.confirmaciones,
  listarParaExportar: m.exportar,
}));
vi.mock("@/lib/facturacion/contexto-factura", () => ({ listarEntidadesEmisoras: m.entidades }));

import { GET as getLista } from "../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/route";
import { GET as getClientes } from "../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/clientes/route";
import { GET as getCliente } from "../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/clientes/[clienteId]/route";
import { GET as getExport } from "../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/export/route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const ctxCliente = (id: string) => ({ params: Promise.resolve({ slug: "acme", clienteId: id }) });
const req = (qs = "") => new Request(`http://x/api?${qs}`);

beforeEach(() => {
  m.verOk = true;
  m.listar.mockReset().mockResolvedValue({ filas: [], totalReal: 0, page: 1, pageSize: 25, porEntidad: [], rotulo: "r" });
  m.clientes.mockReset().mockResolvedValue({ filas: [], totalReal: 0, page: 1, pageSize: 25, rotulo: "r" });
  m.resumen.mockReset().mockResolvedValue({ clienteId: 5, cliente: "A", nit: null, porEntidad: [], rotulo: "r" });
  m.pagos.mockReset().mockResolvedValue({ filas: [], totalReal: 0, page: 1, pageSize: 25 });
  m.confirmaciones.mockReset().mockResolvedValue({ filas: [], totalReal: 0, page: 1, pageSize: 25 });
  m.exportar.mockReset().mockResolvedValue({ ok: true, filas: [] });
  m.entidades.mockReset().mockResolvedValue([{ id: 1, codigo: "KT", nombre: "KuiqTrans" }]);
});

describe("M-2a · endpoints GET de solo lectura (permiso, tenant, filtros)", () => {
  it("sin permiso de Facturación: 403 en TODAS las rutas y no consulta nada", async () => {
    m.verOk = false;
    for (const r of [await getLista(req(), ctx), await getClientes(req(), ctx), await getCliente(req(), ctxCliente("5")), await getExport(req(), ctx)]) {
      expect(r.status).toBe(403);
    }
    for (const f of [m.listar, m.clientes, m.resumen, m.pagos, m.confirmaciones, m.exportar]) expect(f).not.toHaveBeenCalled();
  });

  it("la empresa sale de la sesión aunque la query traiga otra", async () => {
    await getLista(req("empresaId=999&empresa_id=999&vista=cartera"), ctx);
    expect(m.listar).toHaveBeenCalledWith(7, expect.objectContaining({ vista: "cartera" }));
    expect(JSON.stringify(m.listar.mock.calls[0][1])).not.toContain("999");
  });

  it("pasa los filtros validados y devuelve las entidades para el selector", async () => {
    const r = await getLista(req("vista=historial&alcance=pagadas&clienteId=3&entidad=sin&estado=PAGADA&page=2&pageSize=10"), ctx);
    expect(r.status).toBe(200);
    expect(m.listar).toHaveBeenCalledWith(7, expect.objectContaining({ vista: "historial", alcance: "pagadas", clienteId: 3, entidad: "sin", estadoDerivado: "PAGADA", page: 2, pageSize: 10 }));
    const j = await r.json();
    expect(j.entidades).toEqual([{ id: 1, codigo: "KT", nombre: "KuiqTrans" }]);
  });

  it("cliente: id inválido = 400; inexistente en la empresa = 404; válido = resumen + pagos + confirmaciones", async () => {
    expect((await getCliente(req(), ctxCliente("abc"))).status).toBe(400);
    expect((await getCliente(req(), ctxCliente("0"))).status).toBe(400);
    m.resumen.mockResolvedValueOnce(null);
    expect((await getCliente(req(), ctxCliente("5"))).status).toBe(404);
    const ok = await getCliente(req("entidad=2"), ctxCliente("5"));
    expect(ok.status).toBe(200);
    expect(m.resumen).toHaveBeenLastCalledWith(7, 5, 2);
    expect(m.pagos).toHaveBeenCalledWith(7, 5, expect.objectContaining({ entidad: 2 }));
    expect(Object.keys(await ok.json())).toEqual(["resumen", "pagos", "confirmaciones"]);
  });

  it("exportación: .xlsx del filtro; si excede el tope, 400 con mensaje (no trunca)", async () => {
    const ok = await getExport(req("vista=historial"), ctx);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(ok.headers.get("Content-Disposition")).toContain("cuentas-por-cobrar-informativa-historial-facturas.xlsx");
    m.exportar.mockResolvedValueOnce({ ok: false, error: "El filtro devuelve más de 20000 facturas." });
    const grande = await getExport(req(), ctx);
    expect(grande.status).toBe(400);
  });

  it("los módulos de ruta no exportan ningún método de escritura", async () => {
    for (const mod of [
      await import("../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/route"),
      await import("../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/clientes/route"),
      await import("../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/clientes/[clienteId]/route"),
      await import("../../app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/export/route"),
    ]) {
      expect(Object.keys(mod).filter((k) => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
    }
  });
});

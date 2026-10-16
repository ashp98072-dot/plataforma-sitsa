import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ guard: vi.fn(), recalcular: vi.fn(), accion: vi.fn(), listar: vi.fn(), candidatos: vi.fn(), sinReporte: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantFlotaCombustible: m.guard }));
vi.mock("./combustible-c2c", () => ({
  recalcularImportacion: m.recalcular, accionManual: m.accion, listarConciliacion: m.listar, candidatosParaFila: m.candidatos, valesSinReporte: m.sinReporte,
}));
import { accionC2cHttp, candidatosC2cHttp, listarC2cHttp, recalcularC2cHttp, valesSinReporteHttp } from "./combustible-c2c-http";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { Badges } from "@/components/flota/combustible-conciliacion-proveedor";

const prohibido = () => ({ error: new Response(null, { status: 403 }) });
beforeEach(() => {
  vi.resetAllMocks();
  m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 91, username: "op" } });
  m.recalcular.mockResolvedValue({ exactas: 1 }); m.accion.mockResolvedValue({ filaId: 5, estado: "COINCIDENCIA_EXACTA", cargaVinculadaId: 9 });
  m.listar.mockResolvedValue({ filas: [] }); m.candidatos.mockResolvedValue([]); m.sinReporte.mockResolvedValue({ vales: [] });
});
const post = (body: unknown) => new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });

describe("permisos: lecturas = ver; escrituras = conciliar", () => {
  it("lecturas piden «ver» y no ejecutan sin permiso", async () => {
    m.guard.mockResolvedValue(prohibido());
    expect((await listarC2cHttp(new Request("http://l/x"), "e", "10")).status).toBe(403);
    expect((await candidatosC2cHttp(new Request("http://l/x"), "e", "5")).status).toBe(403);
    expect((await valesSinReporteHttp(new Request("http://l/x"), "e")).status).toBe(403);
    expect(m.guard.mock.calls.map(c => c[1])).toEqual(["ver", "ver", "ver"]);
    expect(m.listar).not.toHaveBeenCalled(); expect(m.candidatos).not.toHaveBeenCalled(); expect(m.sinReporte).not.toHaveBeenCalled();
  });
  it("recalcular y acciones piden «conciliar» y no escriben sin permiso", async () => {
    m.guard.mockResolvedValue(prohibido());
    expect((await recalcularC2cHttp("e", "10")).status).toBe(403);
    expect((await accionC2cHttp(post({ accion: "quitar" }), "e", "5")).status).toBe(403);
    expect(m.guard.mock.calls.map(c => c[1])).toEqual(["conciliar", "conciliar"]);
    expect(m.recalcular).not.toHaveBeenCalled(); expect(m.accion).not.toHaveBeenCalled();
  });
});

describe("entradas y errores", () => {
  it("empresa y usuario salen del guard, nunca del cuerpo", async () => {
    expect((await accionC2cHttp(post({ accion: "confirmar", cargaId: 9, empresaId: 99, usuario: "otro" }), "e", "5")).status).toBe(200);
    expect(m.accion).toHaveBeenCalledWith(1, 5, { id: 91, username: "op" }, { accion: "confirmar", cargaId: 9 }, undefined);
    await recalcularC2cHttp("e", "10");
    expect(m.recalcular).toHaveBeenCalledWith(1, 10, { id: 91, username: "op" });
  });
  it("acción inválida / ids inválidos → 400 sin servicio", async () => {
    expect((await accionC2cHttp(post({ accion: "borrar" }), "e", "5")).status).toBe(400);
    expect((await accionC2cHttp(post({ accion: "quitar" }), "e", "0")).status).toBe(400);
    expect((await recalcularC2cHttp("e", "abc")).status).toBe(400);
    expect((await listarC2cHttp(new Request("http://l/x?estado=NOPE"), "e", "10")).status).toBe(400);
    expect((await valesSinReporteHttp(new Request("http://l/x?estado=NOPE"), "e")).status).toBe(400);
    expect(m.accion).not.toHaveBeenCalled();
  });
  it("409 del servicio llega como 409 con el mensaje; error inesperado es 500 genérico", async () => {
    m.accion.mockRejectedValueOnce(new ErrorDominioFormulario("Actualiza y vuelve a intentar.", 409));
    const r = await accionC2cHttp(post({ accion: "confirmar", cargaId: 9 }), "e", "5");
    expect(r.status).toBe(409); expect((await r.json()).error).toBe("Actualiza y vuelve a intentar.");
    m.recalcular.mockRejectedValueOnce(new Error("sql secreto"));
    const e = await recalcularC2cHttp("e", "10");
    expect(e.status).toBe(500); expect(JSON.stringify(await e.json())).not.toContain("secreto");
  });
  it("fila/importación inexistente (o de otra empresa) → 404", async () => {
    m.listar.mockResolvedValueOnce(null); m.candidatos.mockResolvedValueOnce(null);
    expect((await listarC2cHttp(new Request("http://l/x"), "e", "10")).status).toBe(404);
    expect((await candidatosC2cHttp(new Request("http://l/x"), "e", "5")).status).toBe(404);
  });
});

describe("arquitectura y UI", () => {
  it("el servicio nunca escribe en vales, fondos ni contabilidad", () => {
    const src = readFileSync("src/lib/flota/combustible-c2c.ts", "utf8");
    expect(src).not.toMatch(/UPDATE\s+flota_combustible_cargas/i);
    expect(src).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+(tms_|fact_|conta|cxc|cxp|milenium)/i);
    expect(src).not.toMatch(/DELETE FROM flota_combustible_conciliacion_filas/i);
    expect(src).not.toMatch(/proveedorId\s*[:=]\s*(body|req)/i);
  });
  it("el reporte no se enlaza al fondo directamente: solo cadena fila → vale → línea", () => {
    const src = readFileSync("src/lib/flota/combustible-c2c.ts", "utf8");
    expect(src).toContain("contextosFondosCombustible");
    expect(src).not.toMatch(/f\.solicitud_fondo/);
  });
  it("sub-pestaña montada dentro de Combustibles → Conciliación", () => {
    const src = readFileSync("src/components/flota/combustible-conciliacion.tsx", "utf8");
    expect(src).toContain("CombustibleConciliacionProveedor");
    const ui = readFileSync("src/components/flota/combustible-conciliacion-proveedor.tsx", "utf8");
    for (const t of ["Recalcular conciliación", "Exactas", "Con diferencias", "Sin vale interno", "Ambiguas", "Vales internos sin reporte", "Fecha reporte", "Fecha consumo"]) expect(ui).toContain(t);
  });
  it("badges muestran ambos valores", () => {
    const html = renderToStaticMarkup(createElement(Badges, { diferencias: [{ campo: "MONTO", tipo: "DISTINTA", proveedor: "255", interno: "255.50", delta: "0.5" }, { campo: "PLACA", tipo: "DISTINTA", proveedor: "A-1", interno: "B-2", delta: null }] }));
    expect(html).toContain("MONTO Q0.50"); expect(html).toContain("255 → 255.50"); expect(html).toContain("PLACA"); expect(html).toContain("A-1 → B-2");
  });
});

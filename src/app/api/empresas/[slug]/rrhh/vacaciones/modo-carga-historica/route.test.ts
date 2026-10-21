import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), leerModoCargaHistorica: vi.fn(), cambiarModoCargaHistorica: vi.fn(), resincronizarSaldosEmpresa: vi.fn(), previsualizarActivacionModoHistorico: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-modo-db", () => ({ leerModoCargaHistorica: m.leerModoCargaHistorica, cambiarModoCargaHistorica: m.cambiarModoCargaHistorica }));
vi.mock("@/lib/rrhh/vacaciones-modo-preflight-db", () => ({ previsualizarActivacionModoHistorico: m.previsualizarActivacionModoHistorico }));
vi.mock("@/lib/rrhh/vacaciones-modo-resync-db", () => ({ resincronizarSaldosEmpresa: m.resincronizarSaldosEmpresa }));

import { NextResponse } from "next/server";
import { GET, PUT } from "./route";
import { POST as RESYNC } from "./resincronizar/route";
import { GET as PREFLIGHT } from "./preflight/route";

const ctx = { params: Promise.resolve({ slug: "empresa-sintetica" }) };
const put = (b: unknown) => new Request("http://local/api/x", { method: "PUT", body: typeof b === "string" ? b : JSON.stringify(b) });
const post = (b: unknown) => new Request("http://local/api/x", { method: "POST", body: typeof b === "string" ? b : JSON.stringify(b) });
const sinPermiso = () => m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
  m.leerModoCargaHistorica.mockResolvedValue(true);
  m.cambiarModoCargaHistorica.mockResolvedValue({ cambiado: true, valorAnterior: false, valorNuevo: true });
  m.resincronizarSaldosEmpresa.mockResolvedValue({ total: 2, sincronizados: 2, congelados: 0, consumoNoVerificable: 0, errores: 0, resultados: [] });
  m.previsualizarActivacionModoHistorico.mockResolvedValue({ puedeActivar: true, revisados: 27, aptos: 27, bloqueados: 0, motivos: [] });
});

describe("GET modo-carga-historica (solo lectura)", () => {
  it("exige RRHH · Vacaciones · ver, lee SOLO la empresa de la sesión y no cachea", async () => {
    const r = await GET(new Request("http://local/api/x?empresa_id=999"), ctx);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "vacaciones", "ver");
    expect(m.leerModoCargaHistorica).toHaveBeenCalledWith(7);
    expect(await r.json()).toEqual({ activo: true, modo: "CARGA_HISTORICA" });
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    sinPermiso();
    expect((await GET(new Request("http://local/api/x"), ctx)).status).toBe(403);
  });
  it("fallo interno ⇒ 500 sin detalles", async () => {
    m.leerModoCargaHistorica.mockRejectedValue(new Error("boom"));
    const r = await GET(new Request("http://local/api/x"), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});

describe("PUT modo-carga-historica (administración RRHH, con confirmación explícita)", () => {
  it("exige RRHH · Configuración · editar y no cambia nada sin permiso", async () => {
    sinPermiso();
    expect((await PUT(put({ activo: true, confirmar: true }), ctx)).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "configuracion", "editar");
    expect(m.cambiarModoCargaHistorica).not.toHaveBeenCalled();
  });
  it("sin confirmación explícita o con valores inválidos ⇒ 400 y no cambia nada", async () => {
    for (const b of [{}, { activo: true }, { activo: true, confirmar: false }, { activo: "si", confirmar: true }, { confirmar: true }, "no es json", null]) expect((await PUT(put(b), ctx)).status).toBe(400);
    expect(m.cambiarModoCargaHistorica).not.toHaveBeenCalled();
  });
  it("la empresa y el usuario salen del servidor (empresa_id/usuario del cuerpo se ignoran)", async () => {
    const r = await PUT(put({ activo: true, confirmar: true, empresa_id: 999, usuario: "intruso" }), ctx);
    expect(m.cambiarModoCargaHistorica).toHaveBeenCalledWith(7, true, { usuario: "rrhh.ana" });
    expect(await r.json()).toMatchObject({ cambiado: true, activo: true, modo: "CARGA_HISTORICA", valorAnterior: false, valorNuevo: true });
  });
  it("repetir el mismo valor devuelve cambiado=false (idempotente); fallo interno ⇒ 500 genérico", async () => {
    m.cambiarModoCargaHistorica.mockResolvedValue({ cambiado: false, valorAnterior: true, valorNuevo: true });
    expect(await (await PUT(put({ activo: true, confirmar: true }), ctx)).json()).toMatchObject({ cambiado: false });
    m.cambiarModoCargaHistorica.mockRejectedValue(new Error("Duplicate entry"));
    const r = await PUT(put({ activo: false, confirmar: true }), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("Duplicate");
  });
});

describe("ACTIVAR exige el preflight: consumo no verificable ⇒ 409 y NO se cambia nada", () => {
  const bloqueado = { puedeActivar: false, revisados: 27, aptos: 24, bloqueados: 3, motivos: [{ empleadoId: 4, codigo: "E-4", nombre: "Colaborador Sintético", motivos: [{ codigo: "SIN_DETALLE", mensaje: "1 vacación(es) con días tomados y SIN detalle de consumo FIFO." }] }] };
  it("PUT activo=true con preflight bloqueado ⇒ 409 PREFLIGHT_BLOQUEADO con resumen seguro (puedeActivar=false, bloqueados, motivos), sin detalles internos", async () => {
    m.cambiarModoCargaHistorica.mockResolvedValue({ cambiado: false, valorAnterior: false, valorNuevo: false, preflight: bloqueado });
    const r = await PUT(put({ activo: true, confirmar: true }), ctx);
    expect(r.status).toBe(409);
    const b = await r.json();
    expect(b).toMatchObject({ codigo: "PREFLIGHT_BLOQUEADO", puedeActivar: false, bloqueados: 3, revisados: 27, aptos: 24 });
    expect(b.motivos[0]).toMatchObject({ nombre: "Colaborador Sintético", motivos: [{ codigo: "SIN_DETALLE" }] });
    expect(b.error).toContain("No se puede activar el modo histórico todavía");
    expect(JSON.stringify(b)).not.toMatch(/SELECT|FROM |sql/i);
  });
  it("PUT activo=false nunca se bloquea por el preflight (volver a NORMAL siempre es posible)", async () => {
    m.cambiarModoCargaHistorica.mockResolvedValue({ cambiado: true, valorAnterior: true, valorNuevo: false });
    const r = await PUT(put({ activo: false, confirmar: true }), ctx);
    expect(r.status).toBe(200);
    expect(m.cambiarModoCargaHistorica).toHaveBeenCalledWith(7, false, { usuario: "rrhh.ana" });
  });
  it("GET preflight: solo lectura, RRHH · Configuración · editar, empresa de la sesión y, si falla, no se asume que sea seguro activar", async () => {
    sinPermiso();
    expect((await PREFLIGHT(new Request("http://local/api/x"), ctx)).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "configuracion", "editar");
    expect(m.previsualizarActivacionModoHistorico).not.toHaveBeenCalled();
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
    const ok = await PREFLIGHT(new Request("http://local/api/x?empresa_id=999"), ctx);
    expect(m.previsualizarActivacionModoHistorico).toHaveBeenCalledWith(7);
    expect(await ok.json()).toMatchObject({ puedeActivar: true, revisados: 27, aptos: 27, bloqueados: 0 });
    expect(ok.headers.get("Cache-Control")).toContain("no-store");
    m.previsualizarActivacionModoHistorico.mockRejectedValue(new Error("boom"));
    const f = await PREFLIGHT(new Request("http://local/api/x"), ctx);
    expect(f.status).toBe(500);
    expect(JSON.stringify(await f.json())).not.toContain("boom");
  });
});

describe("POST modo-carga-historica/resincronizar (administrada, por colaborador)", () => {
  it("exige RRHH · Configuración · editar y confirmación explícita", async () => {
    sinPermiso();
    expect((await RESYNC(post({ confirmar: true }), ctx)).status).toBe(403);
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
    for (const b of [{}, { confirmar: false }, "no es json", null]) expect((await RESYNC(post(b), ctx)).status).toBe(400);
    expect(m.resincronizarSaldosEmpresa).not.toHaveBeenCalled();
  });
  it("sincroniza SOLO la empresa de la sesión y responde el resumen; fallo ⇒ 500 genérico", async () => {
    const r = await RESYNC(post({ confirmar: true, empresa_id: 999 }), ctx);
    expect(m.resincronizarSaldosEmpresa).toHaveBeenCalledWith(7, { usuario: "rrhh.ana" });
    expect(await r.json()).toMatchObject({ total: 2, sincronizados: 2 });
    m.resincronizarSaldosEmpresa.mockRejectedValue(new Error("boom"));
    const f = await RESYNC(post({ confirmar: true }), ctx);
    expect(f.status).toBe(500);
    expect(JSON.stringify(await f.json())).not.toContain("boom");
  });
});

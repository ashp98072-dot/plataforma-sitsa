import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), leerModoCargaHistorica: vi.fn(), cambiarModoCargaHistorica: vi.fn(), resincronizarSaldosEmpresa: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-modo-db", () => ({ leerModoCargaHistorica: m.leerModoCargaHistorica, cambiarModoCargaHistorica: m.cambiarModoCargaHistorica }));
vi.mock("@/lib/rrhh/vacaciones-modo-resync-db", () => ({ resincronizarSaldosEmpresa: m.resincronizarSaldosEmpresa }));

import { NextResponse } from "next/server";
import { GET, PUT } from "./route";
import { POST as RESYNC } from "./resincronizar/route";

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
  m.resincronizarSaldosEmpresa.mockResolvedValue({ total: 2, sincronizados: 2, congelados: 0, errores: 0, resultados: [] });
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

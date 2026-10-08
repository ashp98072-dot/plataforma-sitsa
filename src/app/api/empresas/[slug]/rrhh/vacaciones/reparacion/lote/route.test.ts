import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), repararLoteVacaciones: vi.fn(), previsualizarReparacionLote: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-reparacion-db", () => ({ repararLoteVacaciones: m.repararLoteVacaciones, previsualizarReparacionLote: m.previsualizarReparacionLote }));

import { NextResponse } from "next/server";
import { POST } from "./route";
import { GET } from "./preview/route";

const H1 = "a".repeat(32);
const H2 = "b".repeat(32);
const ctx = { params: Promise.resolve({ slug: "empresa-sintetica" }) };
const post = (body: unknown) => new Request("http://local/api/x", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const valido = { confirmar: true, empleados: [{ empleadoId: 3, huella: H1 }, { empleadoId: 4, huella: H2 }] };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
  m.repararLoteVacaciones.mockResolvedValue({ solicitados: 2, reparados: 2, bloqueados: 0, cambiosDesdePreview: 0, sinCambios: 0, errores: 0, resultados: [] });
  m.previsualizarReparacionLote.mockResolvedValue({ pendientes: 2, elegibles: 2, bloqueados: 0, sinCambios: 0, filas: [] });
});

describe("GET rrhh/vacaciones/reparacion/lote/preview (SOLO lectura)", () => {
  it("exige RRHH · Vacaciones · editar y no procesa nada sin permiso", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await GET(new Request("http://local/api/x"), ctx)).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "vacaciones", "editar");
    expect(m.previsualizarReparacionLote).not.toHaveBeenCalled();
  });
  it("usa solo la empresa de la SESIÓN (ignora empresa_id del cliente) y no cachea", async () => {
    const r = await GET(new Request("http://local/api/x?empresa_id=999"), ctx);
    expect(r.status).toBe(200);
    expect(m.previsualizarReparacionLote).toHaveBeenCalledWith(7);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
  });
  it("fallo interno ⇒ 500 sin detalles", async () => {
    m.previsualizarReparacionLote.mockRejectedValue(new Error("boom"));
    const r = await GET(new Request("http://local/api/x"), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});

describe("POST rrhh/vacaciones/reparacion/lote", () => {
  it("exige RRHH · Vacaciones · editar y no ejecuta nada sin permiso", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await POST(post(valido), ctx)).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "vacaciones", "editar");
    expect(m.repararLoteVacaciones).not.toHaveBeenCalled();
  });
  it("sin confirmación explícita, sin lista, con huellas inválidas, ids inválidos o demasiados ⇒ 400 y no ejecuta", async () => {
    const malos: unknown[] = [
      {}, { empleados: valido.empleados }, { confirmar: false, empleados: valido.empleados }, { confirmar: "true", empleados: valido.empleados },
      { confirmar: true, empleados: [] }, { confirmar: true }, { confirmar: true, empleados: [{ empleadoId: 3, huella: "x" }] },
      { confirmar: true, empleados: [{ empleadoId: -1, huella: H1 }] }, { confirmar: true, empleados: [{ empleadoId: "3", huella: H1 }] },
      { confirmar: true, empleados: Array.from({ length: 501 }, (_, i) => ({ empleadoId: i + 1, huella: H1 })) }, "no es json", null,
    ];
    for (const b of malos) expect((await POST(post(b), ctx)).status).toBe(400);
    expect(m.repararLoteVacaciones).not.toHaveBeenCalled();
  });
  it("la empresa y el usuario salen del servidor: empresa_id/usuario/fechaAlta del cuerpo se IGNORAN", async () => {
    const r = await POST(post({ ...valido, empresa_id: 999, usuario: "intruso", fechaAlta: "2000-01-01" }), ctx);
    expect(r.status).toBe(200);
    expect(m.repararLoteVacaciones).toHaveBeenCalledWith(7, valido.empleados, { usuario: "rrhh.ana" });
    expect(r.headers.get("Cache-Control")).toContain("no-store");
  });
  it("fallo inesperado del lote ⇒ 500 genérico", async () => {
    m.repararLoteVacaciones.mockRejectedValue(new Error("Duplicate entry"));
    const r = await POST(post(valido), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("Duplicate");
  });
});

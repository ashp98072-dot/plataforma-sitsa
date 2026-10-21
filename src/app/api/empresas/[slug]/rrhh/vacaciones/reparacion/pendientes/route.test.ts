import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), listarPendientesReparacion: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-reparacion-db", () => ({ listarPendientesReparacion: m.listarPendientesReparacion }));

import { NextResponse } from "next/server";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "empresa-sintetica" }) };

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
  m.listarPendientesReparacion.mockResolvedValue({ total: 1, empleados: [{ empleadoId: 3, nombre: "Colaborador Sintético", motivos: ["TRASLAPE_REAL"] }] });
});

describe("GET rrhh/vacaciones/reparacion/pendientes (SOLO lectura)", () => {
  it("exige RRHH · Vacaciones · editar", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await GET(new Request("http://local/api/x"), ctx)).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "vacaciones", "editar");
    expect(m.listarPendientesReparacion).not.toHaveBeenCalled();
  });
  it("lista solo la empresa de la SESIÓN (ignora empresa_id del cliente) y no cachea", async () => {
    const r = await GET(new Request("http://local/api/x?empresa_id=999"), ctx);
    expect(m.listarPendientesReparacion).toHaveBeenCalledWith(7);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(await r.json()).toMatchObject({ total: 1 });
  });
  it("fallo interno ⇒ 500 sin detalles", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.listarPendientesReparacion.mockRejectedValue(new Error("boom"));
    const r = await GET(new Request("http://local/api/x"), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});

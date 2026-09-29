import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireTenantRrhh: vi.fn(),
  listarEntrevistadoresActivos: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/entrevistas", () => ({
  listarEntrevistadoresActivos: m.listarEntrevistadoresActivos,
}));

import { GET } from "./route";

const ctx = (slug = "sitsa") => ({ params: Promise.resolve({ slug }) });
const req = () => new Request("http://x");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ATRACCION-TALENTO-1 (corrección post-revisión) — GET /rrhh/entrevistas/entrevistadores", () => {
  it("1) usuario con entrevistas:ver (aunque no tenga empleados:ver) => 200", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarEntrevistadoresActivos.mockResolvedValue([{ id: 1, codigo: "E001", nombre: "Juan" }]);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ entrevistadores: [{ id: 1, codigo: "E001", nombre: "Juan" }] });
  });

  it("usa el guard con submódulo 'entrevistas' acción 'ver' (no 'empleados')", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarEntrevistadoresActivos.mockResolvedValue([]);
    await GET(req(), ctx("acme"));
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("acme", "entrevistas", "ver");
  });

  it("2) sin entrevistas:ver => 403, y no llama a la consulta", async () => {
    m.requireTenantRrhh.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 }),
    });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
    expect(m.listarEntrevistadoresActivos).not.toHaveBeenCalled();
  });

  it("3) el tenant siempre viene de guard.empresa.id, nunca del slug/body del cliente", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 42 }, session: {} });
    m.listarEntrevistadoresActivos.mockResolvedValue([]);
    await GET(req(), ctx("otra-empresa"));
    expect(m.listarEntrevistadoresActivos).toHaveBeenCalledWith(42);
  });

  it("5) el body solo trae la clave 'entrevistadores' — sin campos sensibles adicionales", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarEntrevistadoresActivos.mockResolvedValue([{ id: 1, codigo: "E001", nombre: "Ana" }]);
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["entrevistadores"]);
    expect(Object.keys(body.entrevistadores[0]).sort()).toEqual(["codigo", "id", "nombre"]);
  });
});

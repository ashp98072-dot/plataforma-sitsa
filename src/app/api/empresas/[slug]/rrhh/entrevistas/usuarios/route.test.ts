import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireTenantRrhh: vi.fn(),
  listarUsuariosEntrevistadores: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/entrevistas", () => ({
  listarUsuariosEntrevistadores: m.listarUsuariosEntrevistadores,
}));

import { GET } from "./route";

const ctx = (slug = "sitsa") => ({ params: Promise.resolve({ slug }) });
const req = () => new Request("http://x");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ATRACCION-TALENTO-2 — GET /rrhh/entrevistas/usuarios", () => {
  it("1) usuario con entrevistas:ver => 200", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarUsuariosEntrevistadores.mockResolvedValue([{ id: 1, nombre: "María López", username: "mlopez", rol: "RRHH" }]);
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ usuarios: [{ id: 1, nombre: "María López", username: "mlopez", rol: "RRHH" }] });
  });

  it("usa el guard con submódulo 'entrevistas' acción 'ver'", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarUsuariosEntrevistadores.mockResolvedValue([]);
    await GET(req(), ctx("acme"));
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("acme", "entrevistas", "ver");
  });

  it("sin entrevistas:ver => 403, y no llama al catálogo", async () => {
    m.requireTenantRrhh.mockResolvedValue({
      error: new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 }),
    });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
    expect(m.listarUsuariosEntrevistadores).not.toHaveBeenCalled();
  });

  it("7) el tenant siempre viene de guard.empresa.id, nunca del slug del cliente", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 42 }, session: {} });
    m.listarUsuariosEntrevistadores.mockResolvedValue([]);
    await GET(req(), ctx("otra-empresa"));
    expect(m.listarUsuariosEntrevistadores).toHaveBeenCalledWith(42);
  });

  it("6) el body solo trae la clave 'usuarios' — sin campos sensibles adicionales", async () => {
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 1 }, session: {} });
    m.listarUsuariosEntrevistadores.mockResolvedValue([{ id: 1, nombre: "Ana", username: "ana", rol: "Admin" }]);
    const res = await GET(req(), ctx());
    const body = await res.json();
    expect(Object.keys(body)).toEqual(["usuarios"]);
    expect(Object.keys(body.usuarios[0]).sort()).toEqual(["id", "nombre", "rol", "username"]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), previsualizarReparacion: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-reparacion-db", () => ({ previsualizarReparacion: m.previsualizarReparacion }));

import { NextResponse } from "next/server";
import { GET } from "./route";

const ctx = (id = "3") => ({ params: Promise.resolve({ slug: "empresa-sintetica", id }) });
const req = (qs = "") => new Request(`http://local/api/x${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
  m.previsualizarReparacion.mockResolvedValue({ requiereReparacion: true, puedeReparar: true, bloqueos: [], huella: "a".repeat(32) });
});

describe("GET empleados/[id]/vacaciones/reparacion/preview (SOLO lectura)", () => {
  it("exige RRHH · Vacaciones · editar y no procesa nada sin permiso", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await GET(req(), ctx())).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("empresa-sintetica", "vacaciones", "editar");
    expect(m.previsualizarReparacion).not.toHaveBeenCalled();
  });
  it("usa la empresa de la SESIÓN (ignora empresa_id/fechaAlta del cliente) y responde sin caché", async () => {
    const r = await GET(req("?empresa_id=999&fechaAlta=2020-01-01"), ctx());
    expect(r.status).toBe(200);
    expect(m.previsualizarReparacion).toHaveBeenCalledWith(7, 3);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(await r.json()).toMatchObject({ requiereReparacion: true });
  });
  it("id inválido ⇒ 400; inexistente o de otra empresa ⇒ 404; fallo interno ⇒ 500 sin detalles", async () => {
    expect((await GET(req(), ctx("abc"))).status).toBe(400);
    expect((await GET(req(), ctx("0"))).status).toBe(400);
    m.previsualizarReparacion.mockResolvedValue(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    m.previsualizarReparacion.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await GET(req(), ctx());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});

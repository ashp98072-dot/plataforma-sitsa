import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), previsualizarRebase: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-rebase-db", () => ({ previsualizarRebase: m.previsualizarRebase }));

import { NextResponse } from "next/server";
import { GET } from "./route";

const ctx = (id = "3") => ({ params: Promise.resolve({ slug: "kt-monaco", id }) });
const get = (qs: string) => new Request(`http://local/api/x?${qs}`);

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
  m.previsualizarRebase.mockResolvedValue({ aplica: true, bloqueos: [], periodos: [], traslapesActuales: 0 });
});

describe("GET empleados/[id]/preview-fecha-alta (SOLO lectura)", () => {
  it("exige RRHH · Empleados · editar y no procesa nada sin permiso", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await GET(get("fechaAlta=2024-01-01"), ctx())).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "empleados", "editar");
    expect(m.previsualizarRebase).not.toHaveBeenCalled();
  });

  it("usa la empresa de la SESIÓN y responde sin caché", async () => {
    const r = await GET(get("fechaAlta=2024-01-01&empresa_id=999"), ctx());
    expect(r.status).toBe(200);
    expect(m.previsualizarRebase).toHaveBeenCalledWith(7, 3, "2024-01-01");
    expect(r.headers.get("Cache-Control")).toContain("no-store");
  });

  it("id o fecha inválidos ⇒ 400; empleado inexistente (o de otra empresa) ⇒ 404; fallo interno ⇒ 500 sin detalles", async () => {
    expect((await GET(get("fechaAlta=2024-01-01"), ctx("abc"))).status).toBe(400);
    expect((await GET(get("fechaAlta=2024/01/01"), ctx())).status).toBe(400);
    expect((await GET(get(""), ctx())).status).toBe(400);
    m.previsualizarRebase.mockResolvedValue(null);
    expect((await GET(get("fechaAlta=2024-01-01"), ctx())).status).toBe(404);
    m.previsualizarRebase.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await GET(get("fechaAlta=2024-01-01"), ctx());
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});

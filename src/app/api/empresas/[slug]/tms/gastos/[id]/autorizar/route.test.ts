import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastosOperativosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/gastos", () => ({ autorizarGasto: vi.fn() }));

import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { autorizarGasto } from "@/lib/tms/gastos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt", id: "12" }) };
const req = () => new Request("http://localhost/x", { method: "POST", body: "{}" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue({
    empresa: { id: 7 },
    session: { id: 9, username: "jefe", nombre: "Jefe Uno", rol: "JefeOperaciones" },
  } as never);
  vi.mocked(autorizarGasto).mockResolvedValue({ id: 12, estado: "Autorizada" } as never);
});

describe("POST gastos/[id]/autorizar", () => {
  it("exige el permiso propio y usa únicamente la identidad de sesión", async () => {
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    expect(requireTenantGastosOperativosAutorizar).toHaveBeenCalledWith("kt", "editar");
    expect(autorizarGasto).toHaveBeenCalledWith(7, 12, expect.objectContaining({
      usuario: "jefe", autorizanteUsuarioId: 9, autorizanteNombre: "Jefe Uno",
    }));
  });

  it("sin permiso no toca la lógica de negocio", async () => {
    vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(403);
    expect(autorizarGasto).not.toHaveBeenCalled();
  });
});

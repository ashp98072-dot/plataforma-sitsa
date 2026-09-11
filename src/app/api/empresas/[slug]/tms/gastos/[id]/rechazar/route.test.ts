import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastosOperativosAutorizar: vi.fn() }));
vi.mock("@/lib/tms/gastos", () => ({ rechazarGasto: vi.fn() }));

import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { rechazarGasto } from "@/lib/tms/gastos";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt", id: "12" }) };
const req = (body: unknown) => new Request("http://localhost/x", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastosOperativosAutorizar).mockResolvedValue({
    empresa: { id: 7 }, session: { id: 9, username: "jefe", nombre: "Jefe Uno", rol: "JefeOperaciones" },
  } as never);
  vi.mocked(rechazarGasto).mockResolvedValue({ id: 12, estado: "Rechazada" } as never);
});

describe("POST gastos/[id]/rechazar", () => {
  it("exige el mismo permiso propio que autorizar y conserva el motivo", async () => {
    const res = await POST(req({ motivoRechazo: "No corresponde" }), ctx);
    expect(res.status).toBe(200);
    expect(requireTenantGastosOperativosAutorizar).toHaveBeenCalledWith("kt", "editar");
    expect(rechazarGasto).toHaveBeenCalledWith(7, 12, { usuario: "jefe", motivoRechazo: "No corresponde" });
  });

  it("rechaza un motivo vacío sin tocar la lógica de negocio", async () => {
    const res = await POST(req({ motivoRechazo: "" }), ctx);
    expect(res.status).toBe(400);
    expect(rechazarGasto).not.toHaveBeenCalled();
  });
});

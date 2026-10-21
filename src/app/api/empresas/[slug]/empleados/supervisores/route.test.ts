import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/supervisores-catalogo", () => ({ listarCatalogoSupervisores: vi.fn() }));
import { requireTenantRrhh } from "@/lib/tenant";
import { listarCatalogoSupervisores } from "@/lib/rrhh/supervisores-catalogo";
import { GET } from "./route";
const ctx = { params: Promise.resolve({ slug: "empresa" }) };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3 } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(listarCatalogoSupervisores).mockResolvedValue([{ id: 7, nombre: "Ana", numeroEmpleado: "000007", codigo: "C7" }]);
});
it("permiso idéntico, empresa del guard y contrato mínimo", async () => {
  const res = await GET(new Request("http://local/supervisores?empresa=99"), ctx);
  expect(requireTenantRrhh).toHaveBeenCalledWith("empresa", "empleados", "ver");
  expect(listarCatalogoSupervisores).toHaveBeenCalledExactlyOnceWith(3);
  expect(await res.json()).toEqual({ empleados: [{ id: 7, nombre: "Ana", numeroEmpleado: "000007", codigo: "C7" }] });
  expect(res.headers.get("Cache-Control")).toBe("private, no-store");
});
it("sin permiso no lee catálogo", async () => {
  vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new NextResponse(null, { status: 403 }) });
  expect((await GET(new Request("http://local"), ctx)).status).toBe(403);
  expect(listarCatalogoSupervisores).not.toHaveBeenCalled();
});

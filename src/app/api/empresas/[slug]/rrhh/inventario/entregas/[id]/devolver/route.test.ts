import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/inventario", () => ({ registrarDevolucion: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { registrarDevolucion } from "@/lib/rrhh/inventario";
import { POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ slug: "kt-monaco", id }) });
const post = (id: string, body: unknown) =>
  POST(new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }), ctx(id));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({
    error: null,
    empresa: { id: 7, nombre: "KT" },
    session: { username: "ops", id: 3 },
  } as never);
});

it("valida con requireTenantRrhh(slug, 'inventario', 'editar') — tenant SIEMPRE desde la sesión", async () => {
  vi.mocked(registrarDevolucion).mockResolvedValue({ ok: true, ajusteId: 1, entregaId: 40, cantidad: 1, stockResultante: 6 } as never);
  await post("40", { cantidad: 1, motivo: "x" });
  expect(requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "inventario", "editar");
  expect(vi.mocked(registrarDevolucion).mock.calls[0][0]).toBe(7); // empresaId del guard, nunca del body
});

it("id inválido -> 400 sin llamar a registrarDevolucion", async () => {
  const res = await post("abc", { cantidad: 1, motivo: "x" });
  expect(res.status).toBe(400);
  expect(registrarDevolucion).not.toHaveBeenCalled();
});

it("body inválido (sin motivo) -> 400", async () => {
  const res = await post("40", { cantidad: 1 });
  expect(res.status).toBe(400);
  expect(registrarDevolucion).not.toHaveBeenCalled();
});

it.each([
  ["no_encontrado", 404],
  ["cantidad_excede_disponible", 409],
  ["stock_insuficiente", 409],
  ["motivo_requerido", 400],
  ["devolucion_con_cobro_requiere_ajuste", 409],
  ["error", 500],
])("motivo %s -> status %i", async (motivo, status) => {
  vi.mocked(registrarDevolucion).mockResolvedValue({ ok: false, motivo, mensaje: "x" } as never);
  const res = await post("40", { cantidad: 1, motivo: "x" });
  expect(res.status).toBe(status);
});

it("éxito devuelve el resultado y un mensaje", async () => {
  vi.mocked(registrarDevolucion).mockResolvedValue({ ok: true, ajusteId: 9, entregaId: 40, cantidad: 2, stockResultante: 7 } as never);
  const res = await post("40", { cantidad: 2, motivo: "Talla incorrecta" });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data).toMatchObject({ ajusteId: 9, entregaId: 40, cantidad: 2, stockResultante: 7 });
});

import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/inventario", () => ({ registrarCambio: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { registrarCambio } from "@/lib/rrhh/inventario";
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
  vi.mocked(registrarCambio).mockResolvedValue({
    ok: true, ajusteId: 1, entregaId: 40, entregaNuevaId: 41, cantidad: 1,
    stockResultanteOriginal: 6, stockResultanteNuevo: 4,
  } as never);
  await post("40", { cantidad: 1, articuloNuevoId: 2, motivo: "x" });
  expect(requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "inventario", "editar");
  expect(vi.mocked(registrarCambio).mock.calls[0][0]).toBe(7);
});

it("body sin articuloNuevoId -> 400", async () => {
  const res = await post("40", { cantidad: 1, motivo: "x" });
  expect(res.status).toBe(400);
  expect(registrarCambio).not.toHaveBeenCalled();
});

it.each([
  ["no_encontrado", 404],
  ["cantidad_excede_disponible", 409],
  ["stock_insuficiente", 409],
  ["diferencia_precio_no_soportada", 409],
  ["articulo_igual", 400],
  ["articulo_invalido", 400],
  ["error", 500],
])("motivo %s -> status %i", async (motivo, status) => {
  vi.mocked(registrarCambio).mockResolvedValue({ ok: false, motivo, mensaje: "x" } as never);
  const res = await post("40", { cantidad: 1, articuloNuevoId: 2, motivo: "x" });
  expect(res.status).toBe(status);
});

it("éxito devuelve entregaNuevaId y stocks resultantes", async () => {
  vi.mocked(registrarCambio).mockResolvedValue({
    ok: true, ajusteId: 5, entregaId: 40, entregaNuevaId: 77, cantidad: 1,
    stockResultanteOriginal: 6, stockResultanteNuevo: 4,
  } as never);
  const res = await post("40", { cantidad: 1, articuloNuevoId: 2, motivo: "Talla incorrecta" });
  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data).toMatchObject({ entregaNuevaId: 77, stockResultanteOriginal: 6, stockResultanteNuevo: 4 });
});

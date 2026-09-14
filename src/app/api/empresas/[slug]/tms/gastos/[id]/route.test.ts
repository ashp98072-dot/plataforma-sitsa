import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/gastos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/gastos")>();
  return { ...actual, actualizarGasto: vi.fn(), obtenerGasto: vi.fn() };
});

import { requireTenantGastos } from "@/lib/tenant";
import { actualizarGasto } from "@/lib/tms/gastos";
import { GET, PATCH } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba", id: "10" }) };

function patchReq(body: unknown) {
  return new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantGastos>>,
  );
  vi.mocked(actualizarGasto).mockResolvedValue({ id: 10 } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/gastos/[id]", () => {
  it("exige permiso 'ver'", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
  });
});

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 3) — mismo criterio que el schema de
 * creación (route.test.ts): acepta los 5 campos opcionales, nunca
 * estado/autorizante*.
 */
describe("PATCH /tms/gastos/[id] — schema administrativo (GASTOS-ADMINISTRATIVO-1, Fase 3)", () => {
  it("exige permiso 'editar' antes de tocar el body", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await PATCH(patchReq({ monto: 100 }), ctx);
    expect(res.status).toBe(403);
    expect(actualizarGasto).not.toHaveBeenCalled();
  });

  it("acepta los 5 campos administrativos opcionales y los pasa tal cual a actualizarGasto", async () => {
    const res = await PATCH(patchReq({
      entidadRequirenteId: 4, requirenteEmpleadoId: 3, requirenteNombre: "Juan Pérez",
      requirenteUsuarioId: 12, solicitanteUsuarioId: 5,
    }), ctx);
    expect(res.status).toBe(200);
    expect(actualizarGasto).toHaveBeenCalledWith(7, 10, expect.objectContaining({
      entidadRequirenteId: 4, requirenteEmpleadoId: 3, requirenteNombre: "Juan Pérez",
      requirenteUsuarioId: 12, solicitanteUsuarioId: 5,
    }));
  });

  it("permite limpiar requirenteEmpleadoId/requirenteUsuarioId/solicitanteUsuarioId enviando null", async () => {
    await PATCH(patchReq({ requirenteEmpleadoId: null, requirenteUsuarioId: null, solicitanteUsuarioId: null }), ctx);
    expect(actualizarGasto).toHaveBeenCalledWith(7, 10, expect.objectContaining({
      requirenteEmpleadoId: null, requirenteUsuarioId: null, solicitanteUsuarioId: null,
    }));
  });

  it("NUNCA acepta estado/autorizante* — no están en el schema, Zod los descarta aunque el cliente los mande", async () => {
    await PATCH(patchReq({
      monto: 100, estado: "Autorizada", autorizanteUsuarioId: 999, autorizanteNombre: "Nombre Falso",
    }), ctx);
    const [, , cambios] = vi.mocked(actualizarGasto).mock.calls[0]!;
    expect(cambios).not.toHaveProperty("estado");
    expect(cambios).not.toHaveProperty("autorizanteUsuarioId");
    expect(cambios).not.toHaveProperty("autorizanteNombre");
  });

  it("gasto no encontrado -> 404", async () => {
    vi.mocked(actualizarGasto).mockResolvedValue(null);
    const res = await PATCH(patchReq({ monto: 100 }), ctx);
    expect(res.status).toBe(404);
  });
});

/** GASTOS-COMPROBANTE-404-1 — categoría nueva del catálogo compartido, también al EDITAR un gasto existente. */
describe("PATCH /tms/gastos/[id] — acepta la categoría 'Reintegro de gastos' (GASTOS-COMPROBANTE-404-1)", () => {
  it("categoría 'Reintegro de gastos' -> 200, se guarda", async () => {
    const res = await PATCH(patchReq({ categoria: "Reintegro de gastos" }), ctx);
    expect(res.status).toBe(200);
    const [, , cambios] = vi.mocked(actualizarGasto).mock.calls[0]!;
    expect(cambios).toHaveProperty("categoria", "Reintegro de gastos");
  });

  it("categoría fuera del catálogo sigue rechazándose", async () => {
    const res = await PATCH(patchReq({ categoria: "Categoría inventada" }), ctx);
    expect(res.status).toBe(400);
    expect(actualizarGasto).not.toHaveBeenCalled();
  });
});

/**
 * GASTOS-MULTIPLES-LINEAS-1 — semántica de PATCH (decisión #2, aprobada):
 * `lineas` ausente = no se envía a actualizarGasto (no modifica líneas);
 * con elementos = se pasa tal cual (reemplazo total en actualizarGasto);
 * `lineas: []` se rechaza aquí mismo en el schema, con `.min(1)` — nunca
 * llega a actualizarGasto como "borrar todas las líneas silenciosamente".
 */
describe("PATCH /tms/gastos/[id] — schema de líneas (GASTOS-MULTIPLES-LINEAS-1)", () => {
  it("sin `lineas` en el body: no se envía la clave a actualizarGasto (no modifica líneas)", async () => {
    await PATCH(patchReq({ monto: 100 }), ctx);
    const [, , cambios] = vi.mocked(actualizarGasto).mock.calls[0]!;
    expect(cambios).not.toHaveProperty("lineas");
  });

  it("con líneas: se pasan tal cual a actualizarGasto (reemplazo total)", async () => {
    const res = await PATCH(patchReq({
      lineas: [{ categoria: "Combustible", monto: 300 }, { categoria: "Parqueo", monto: 50 }],
    }), ctx);
    expect(res.status).toBe(200);
    expect(actualizarGasto).toHaveBeenCalledWith(7, 10, expect.objectContaining({
      lineas: [{ categoria: "Combustible", monto: 300 }, { categoria: "Parqueo", monto: 50 }],
    }));
  });

  it("`lineas: []` (array vacío) se rechaza en el propio schema (decisión #2) — 400, nunca llega a actualizarGasto", async () => {
    const res = await PATCH(patchReq({ lineas: [] }), ctx);
    expect(res.status).toBe(400);
    expect(actualizarGasto).not.toHaveBeenCalled();
  });

  it("una línea con categoría fuera del catálogo se rechaza", async () => {
    const res = await PATCH(patchReq({ lineas: [{ categoria: "Categoría inventada", monto: 100 }] }), ctx);
    expect(res.status).toBe(400);
    expect(actualizarGasto).not.toHaveBeenCalled();
  });
});

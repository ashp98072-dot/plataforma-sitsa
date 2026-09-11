import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/gastos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/gastos")>();
  return { ...actual, crearGasto: vi.fn(), listarGastos: vi.fn(() => Promise.resolve([])) };
});

import { requireTenantGastos } from "@/lib/tenant";
import { crearGasto } from "@/lib/tms/gastos";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

function postReq(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const bodyBase = { fechaSolicitud: "2026-09-01", categoria: "Combustible", monto: 100 };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantGastos>>,
  );
  vi.mocked(crearGasto).mockResolvedValue({ id: 55 } as never);
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/gastos", () => {
  it("exige permiso 'ver' antes de listar", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
  });
});

/**
 * GASTOS-ADMINISTRATIVO-1 (Fase 3) — el schema de creación acepta los 5
 * campos administrativos opcionales, y NUNCA acepta estado/autorizante*
 * (ni siquiera están declarados — Zod los descarta si el cliente los manda).
 */
describe("POST /tms/gastos — schema administrativo (GASTOS-ADMINISTRATIVO-1, Fase 3)", () => {
  it("exige permiso 'crear' antes de tocar el body", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await POST(postReq(bodyBase), ctx);
    expect(res.status).toBe(403);
    expect(crearGasto).not.toHaveBeenCalled();
  });

  it("acepta los 5 campos administrativos opcionales y los pasa tal cual a crearGasto", async () => {
    const res = await POST(postReq({
      ...bodyBase,
      entidadRequirenteId: 4,
      requirenteEmpleadoId: 3,
      requirenteNombre: "Juan Pérez",
      requirenteUsuarioId: 12,
      solicitanteUsuarioId: 5,
    }), ctx);
    expect(res.status).toBe(200);
    expect(crearGasto).toHaveBeenCalledWith(7, expect.objectContaining({
      entidadRequirenteId: 4, requirenteEmpleadoId: 3, requirenteNombre: "Juan Pérez",
      requirenteUsuarioId: 12, solicitanteUsuarioId: 5,
    }), "ops1");
  });

  it("sin ninguno de los 5 campos: crea igual que antes de esta fase (todos opcionales)", async () => {
    const res = await POST(postReq(bodyBase), ctx);
    expect(res.status).toBe(200);
    expect(crearGasto).toHaveBeenCalledOnce();
  });

  it("NUNCA acepta estado/autorizante* — no están en el schema, Zod los descarta aunque el cliente los mande", async () => {
    await POST(postReq({
      ...bodyBase,
      estado: "Autorizada",
      autorizanteUsuarioId: 999,
      autorizanteNombre: "Nombre Falso",
      autorizadoEn: "2026-01-01",
    }), ctx);
    const [, input] = vi.mocked(crearGasto).mock.calls[0]!;
    expect(input).not.toHaveProperty("estado");
    expect(input).not.toHaveProperty("autorizanteUsuarioId");
    expect(input).not.toHaveProperty("autorizanteNombre");
    expect(input).not.toHaveProperty("autorizadoEn");
  });
});

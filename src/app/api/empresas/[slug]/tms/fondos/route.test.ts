import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/gastos", () => ({ CATEGORIAS_GASTO: ["Combustible", "Otros"] }));
vi.mock("@/lib/tms/fondos", () => ({
  ESTADOS_FONDO: ["Pendiente", "Autorizada", "Rechazada", "Liquidada"],
  crearSolicitudFondo: vi.fn(),
  listarSolicitudesFondo: vi.fn(() => Promise.resolve([])),
}));

import { requireTenantGastos } from "@/lib/tenant";
import { listarSolicitudesFondo } from "@/lib/tms/fondos";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantGastos>>,
  );
});
afterEach(() => vi.restoreAllMocks());

/**
 * REPORTES-FONDOS-PDF-TABULAR-1 — el listado en pantalla ahora reenvía el
 * filtro Requirente a listarSolicitudesFondo, mismo criterio ya usado por
 * las exportaciones (nunca un filtrado paralelo en el cliente).
 */
describe("GET /tms/fondos — filtro Requirente", () => {
  it("con requirenteUsuarioId numérico válido, lo pasa a listarSolicitudesFondo", async () => {
    await GET(new Request("http://localhost/x?requirenteUsuarioId=9"), ctx);
    expect(listarSolicitudesFondo).toHaveBeenCalledWith(7, expect.objectContaining({ requirenteUsuarioId: 9 }));
  });

  it("sin requirenteUsuarioId, pasa undefined (todos los requirentes)", async () => {
    await GET(new Request("http://localhost/x"), ctx);
    expect(listarSolicitudesFondo).toHaveBeenCalledWith(7, expect.objectContaining({ requirenteUsuarioId: undefined }));
  });

  it.each(["0", "-3", "abc", ""])("requirenteUsuarioId inválido (%s) se ignora, nunca revienta", async (valor) => {
    await GET(new Request(`http://localhost/x?requirenteUsuarioId=${valor}`), ctx);
    expect(listarSolicitudesFondo).toHaveBeenCalledWith(7, expect.objectContaining({ requirenteUsuarioId: undefined }));
  });

  it("combina con estado y fechas ya existentes, sin perderlos", async () => {
    await GET(new Request("http://localhost/x?estado=Autorizada&fechaDesde=2026-09-01&fechaHasta=2026-09-30&requirenteUsuarioId=9"), ctx);
    expect(listarSolicitudesFondo).toHaveBeenCalledWith(7, {
      estado: "Autorizada", fechaDesde: "2026-09-01", fechaHasta: "2026-09-30", requirenteUsuarioId: 9,
    });
  });

  it("exige permiso antes de listar", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: new Response(null, { status: 403 }) } as never);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(listarSolicitudesFondo).not.toHaveBeenCalled();
  });
});

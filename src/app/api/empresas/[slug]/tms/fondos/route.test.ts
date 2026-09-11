import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/gastos", () => ({
  CATEGORIAS_GASTO: ["Combustible", "Otros"],
  // FONDOS-GASTOS-METODO-PAGO-1 — la ruta hace z.enum(METODOS_PAGO_GASTO) al cargar el módulo; sin este mock, undefined revienta el schema.
  METODOS_PAGO_GASTO: ["Efectivo", "Transferencia", "Transferencia móvil", "Tarjeta", "Cheque", "Otro"],
}));
vi.mock("@/lib/tms/fondos", () => ({
  ESTADOS_FONDO: ["Pendiente", "Autorizada", "Rechazada", "Liquidada"],
  crearSolicitudFondo: vi.fn(),
  listarSolicitudesFondo: vi.fn(() => Promise.resolve([])),
}));

import { requireTenantGastos } from "@/lib/tenant";
import { crearSolicitudFondo, listarSolicitudesFondo } from "@/lib/tms/fondos";
import { GET, POST } from "./route";

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

function postReq(body: Record<string, unknown>) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const lineaBase = { categoria: "Combustible", monto: 100 };
const bodyBase = { entidadRequirenteId: 10, solicitanteUsuarioId: 9, fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan" };

it("exige empresa requirente al crear", async () => {
  const res = await POST(postReq({ solicitanteUsuarioId: 9, fechaRequerimiento: "2026-09-01", requirenteNombre: "Juan", lineas: [lineaBase] }), ctx);
  expect(res.status).toBe(400);
  expect(crearSolicitudFondo).not.toHaveBeenCalled();
});

/** FONDOS-GASTOS-METODO-PAGO-1 — el schema acepta/rechaza metodoPago por línea con el mismo catálogo que Gastos. */
describe("POST /tms/fondos — schema de metodoPago por línea", () => {
  it("acepta un método del catálogo existente", async () => {
    vi.mocked(crearSolicitudFondo).mockResolvedValue({ id: 1 } as never);
    const res = await POST(postReq({ ...bodyBase, lineas: [{ ...lineaBase, metodoPago: "Transferencia móvil" }] }), ctx);
    expect(res.status).toBe(200);
    expect(crearSolicitudFondo).toHaveBeenCalled();
  });

  it("acepta metodoPago ausente/null (comportamiento tradicional, sin romper históricos)", async () => {
    vi.mocked(crearSolicitudFondo).mockResolvedValue({ id: 1 } as never);
    const res = await POST(postReq({ ...bodyBase, lineas: [{ ...lineaBase }] }), ctx);
    expect(res.status).toBe(200);
  });

  it("rechaza un método fuera del catálogo, sin llegar a crearSolicitudFondo", async () => {
    const res = await POST(postReq({ ...bodyBase, lineas: [{ ...lineaBase, metodoPago: "Bitcoin" }] }), ctx);
    expect(res.status).toBe(400);
    expect(crearSolicitudFondo).not.toHaveBeenCalled();
  });
});

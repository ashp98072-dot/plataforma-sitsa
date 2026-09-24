import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn(), requireTenantProgramacionOTms: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn(() => Promise.resolve()) }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({
  listarDisponibilidadVehiculos: vi.fn(),
  placasDisponiblesParaPlan: vi.fn((list: { puedeEnviar: boolean; placa: string }[]) => list.filter((v) => v.puedeEnviar).map((v) => v.placa)),
}));
vi.mock("@/lib/tms/paradas", () => ({ guardarParadasPlan: vi.fn(), listarParadasDePlanes: vi.fn(() => Promise.resolve(new Map())) }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(), generarCodigoPlan: vi.fn() }));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/flota/pilotos", () => ({ vehiculoPorPlaca: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad-personal", () => ({ listarDisponibilidadPersonal: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/lib/tms/viaticos", () => ({ listarViaticosRechazadosDelPlan: vi.fn(), personalRecienAsignadoDelPlan: vi.fn(), sincronizarViaticosPlan: vi.fn() }));

import { query } from "@/lib/db";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { listarDisponibilidadVehiculos, placasDisponiblesParaPlan } from "@/lib/operaciones/disponibilidad";
import { GET } from "./route";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-3: GET /tms/planes expone (de forma ADITIVA) los ids exactos que la edición rápida
 * necesita para armar el snapshot `esperado`: `flotaVehiculoId` (tms_unidades.flota_vehiculo_id) y
 * `auxiliarPersonalIds` (SOLO tms_plan_auxiliares, en orden — sin el fallback legado de auxiliaresDetalle).
 */
const ctx = { params: Promise.resolve({ slug: "sitsa" }) };
const get = () => GET(new Request("http://localhost/api/empresas/sitsa/tms/planes?fechaDesde=2026-09-25&fechaHasta=2026-09-25"), ctx);
const fila = (over: Record<string, unknown> = {}) => ({
  id: 1, codigo: "PLAN-1", fecha_plan: "2026-09-25", estado: "Programado", hora_carga: "08:00:00", regreso_estimado: "2026-09-25T18:00",
  placa: "C-123", piloto: "Carlos", piloto_id: 11, auxiliar: null, auxiliar_id: null, flota_vehiculo_id: 501, tc_vehiculo_id: 700, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ empresa: { id: 7, nombre: "SITSA" }, session: { id: 1, username: "ops" } } as never);
  vi.mocked(query).mockResolvedValue([] as never);
  vi.mocked(placasDisponiblesParaPlan).mockReturnValue([] as never);
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [], resumen: {}, empresaId: 7 } as never);
});

describe("GET /tms/planes — datos para Edición rápida (aditivo)", () => {
  it("el SELECT trae u.flota_vehiculo_id por el mismo JOIN de la unidad y sigue filtrando por empresa", async () => {
    await get();
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("u.flota_vehiculo_id");
    expect(sql).toContain("LEFT JOIN tms_unidades u ON u.id = p.unidad_id");
    expect(sql).toContain("p.empresa_id = ?");
  });

  it("expone flotaVehiculoId y auxiliarPersonalIds (orden de tms_plan_auxiliares) sin quitar los campos existentes", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([fila()] as never)
      .mockResolvedValueOnce([
        { plan_id: 1, personal_id: 22, id_empleado: null, nombre: "Ana", telefono: null },
        { plan_id: 1, personal_id: 21, id_empleado: null, nombre: "Beto", telefono: null },
      ] as never);
    const data = await (await get()).json();
    const p = data.planes[0];
    expect(p).toMatchObject({
      flotaVehiculoId: 501, auxiliarPersonalIds: [22, 21], pilotoId: 11, tc_vehiculo_id: 700,
      estado: "Programado", fecha_plan: "2026-09-25", hora_carga: "08:00:00", regreso_estimado: "2026-09-25T18:00",
      placa: "C-123", auxiliares: ["Ana", "Beto"],
    });
    expect(p.auxiliaresDetalle.map((a: { personalId: number }) => a.personalId)).toEqual([22, 21]);
    expect(p).not.toHaveProperty("flota_vehiculo_id");
  });

  it("auxiliar legado (solo columna auxiliar_id): auxiliaresDetalle conserva el fallback, auxiliarPersonalIds queda vacío", async () => {
    vi.mocked(query).mockResolvedValueOnce([fila({ auxiliar: "Legado", auxiliar_id: 30, flota_vehiculo_id: null })] as never);
    const data = await (await get()).json();
    const p = data.planes[0];
    expect(p.auxiliaresDetalle.map((a: { personalId: number }) => a.personalId)).toEqual([30]);
    expect(p.auxiliarPersonalIds).toEqual([]);
    expect(p.flotaVehiculoId).toBeNull();
  });
});

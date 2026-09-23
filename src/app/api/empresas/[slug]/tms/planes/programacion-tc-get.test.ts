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
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — GET /tms/planes: el TC llega resuelto en
 * `tc` (Propio: TC interno; Tercerizado: snapshot) y el catálogo de
 * vehículos separa Unidad de TC.
 */
const ctx = { params: Promise.resolve({ slug: "sitsa" }) };
const veh = (id: number, placa: string, tipoUnidad: "VEHICULO" | "CABEZAL" | "TC") => ({
  id, placa, marca: null, modelo: null, tipoUnidad, compartido: false, esPropio: true, puedeEnviar: true,
  estadoDisponibilidad: "disponible", motivoNoDisponible: null,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ empresa: { id: 7, nombre: "SITSA" }, session: { id: 1, username: "ops" } } as never);
  vi.mocked(query).mockResolvedValue([] as never);
  vi.mocked(placasDisponiblesParaPlan).mockImplementation(((list: { puedeEnviar: boolean; placa: string }[]) => list.filter((v) => v.puedeEnviar).map((v) => v.placa)) as never);
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
    vehiculos: [veh(1, "C-123ABC", "CABEZAL"), veh(2, "TC-045", "TC"), veh(3, "P-500", "VEHICULO")],
    resumen: { total: 3, disponibles: 3, enTaller: 0, enRuta: 0, inactivos: 0, propios: 3, compartidos: 0 },
    empresaId: 7,
  } as never);
});

const get = () => GET(new Request("http://localhost/api/empresas/sitsa/tms/planes?fechaDesde=2026-09-23&fechaHasta=2026-09-23"), ctx);

describe("GET /tms/planes — TC del viaje", () => {
  it("el SELECT devuelve `tc` resuelto por tipo de viaje (Tercerizado: snapshot externo; Propio: TC interno o su fotografía) y las columnas crudas por separado", async () => {
    await get();
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("LEFT JOIN flota_vehiculos tcv ON tcv.id = p.tc_vehiculo_id");
    expect(sql).toContain("CASE WHEN p.tipo_viaje = 'Tercerizado' THEN p.tc_externo_placa");
    expect(sql).toContain("COALESCE(tcv.placa, p.tc_placa_historica) END AS tc");
    expect(sql).toContain("p.tc_vehiculo_id, p.tc_placa_historica, p.tc_externo_placa");
    expect(sql).toContain("p.empresa_id = ?");
  });

  it("el TC llega al cliente junto a la unidad (no la sustituye)", async () => {
    vi.mocked(query).mockResolvedValueOnce([{ id: 1, codigo: "PLAN-1", fecha_plan: "2026-09-23", estado: "Programado", placa: "C-123ABC", tc: "TC-045", tc_vehiculo_id: 2 }] as never);
    const data = await (await get()).json();
    expect(data.planes[0]).toMatchObject({ placa: "C-123ABC", tc: "TC-045", tc_vehiculo_id: 2 });
  });
});

describe("GET /tms/planes — catálogo: Unidad y TC nunca mezclados", () => {
  it("estadoVehiculos trae TODOS (con id y tipoUnidad) para que el formulario los separe", async () => {
    const data = await (await get()).json();
    expect(data.estadoVehiculos.map((v: { placa: string; tipoUnidad: string; id: number }) => [v.id, v.placa, v.tipoUnidad])).toEqual([
      [1, "C-123ABC", "CABEZAL"], [2, "TC-045", "TC"], [3, "P-500", "VEHICULO"],
    ]);
  });

  it("los TC no se ofrecen como Unidad en placasFlota ni en vehiculosDisponibles (otros consumidores)", async () => {
    const data = await (await get()).json();
    expect(data.placasFlota).toEqual(["C-123ABC", "P-500"]);
    expect(data.vehiculosDisponibles.map((v: { placa: string }) => v.placa)).toEqual(["C-123ABC", "P-500"]);
  });

  it("sin vehículos clasificados como TC el resultado es el de siempre (nada se oculta)", async () => {
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
      vehiculos: [veh(1, "C-123ABC", "VEHICULO"), veh(3, "P-500", "VEHICULO")],
      resumen: { total: 2, disponibles: 2, enTaller: 0, enRuta: 0, inactivos: 0, propios: 2, compartidos: 0 },
      empresaId: 7,
    } as never);
    const data = await (await get()).json();
    expect(data.placasFlota).toEqual(["C-123ABC", "P-500"]);
    expect(data.estadoVehiculos).toHaveLength(2);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import {
  reporteGastosPorCategoria,
  reporteGastosPorCliente,
  reporteGastosPorPeriodo,
  reporteGastosPorUnidad,
  reporteGastosPorViaje,
  reporteRentabilidadPorViaje,
  reporteViaticosPorViajeEmpleado,
} from "./reportes-gastos";

beforeEach(() => vi.resetAllMocks());

describe("reportes agregados de gastos", () => {
  it("por categoría: agrupa y mapea registros/total", async () => {
    vi.mocked(query).mockResolvedValue([
      { clave: "Combustible", etiqueta: "Combustible", registros: 3, total_monto: "1350.00" },
    ] as never);
    const filas = await reporteGastosPorCategoria(7);
    expect(filas).toEqual([{ clave: "Combustible", etiqueta: "Combustible", registros: 3, totalMonto: 1350 }]);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("GROUP BY g.categoria");
  });

  it("por viaje: siempre filtra activo=1 y aísla por empresa", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosPorViaje(7, { fechaDesde: "2026-01-01" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("g.empresa_id = ?");
    expect(sql).toContain("g.activo = 1");
    expect(params).toEqual([7, "2026-01-01"]);
  });

  it("por unidad y por cliente usan sus propios GROUP BY", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosPorUnidad(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("GROUP BY g.vehiculo_id");
    await reporteGastosPorCliente(7);
    expect(vi.mocked(query).mock.calls[1][0]).toContain("GROUP BY g.cliente_id");
  });

  it("por período agrupa por mes calendario", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await reporteGastosPorPeriodo(7);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("%Y-%m");
  });
});

describe("reporteViaticosPorViajeEmpleado", () => {
  it("mapea filas del join tms_viaticos + tms_planes_viaje + tms_personal", async () => {
    vi.mocked(query).mockResolvedValue([{
      viatico_id: 1, plan_id: 2, plan_codigo: "PLAN-1", fecha_plan: "2026-09-01",
      personal_id: 3, personal_nombre: "Juan Perez", rol: "Piloto",
      monto_sugerido: "150.00", monto_asignado: "150.00", estado: "PROGRAMADO",
    }] as never);
    const [f] = await reporteViaticosPorViajeEmpleado(7);
    expect(f).toEqual({
      viaticoId: 1, planId: 2, planCodigo: "PLAN-1", fechaPlan: "2026-09-01",
      personalId: 3, personalNombre: "Juan Perez", rol: "Piloto",
      montoSugerido: 150, montoAsignado: 150, estado: "PROGRAMADO",
    });
  });
});

describe("reporteRentabilidadPorViaje", () => {
  it("calcula utilidad = tarifa - costoOperativo - gastos - viaticos", async () => {
    vi.mocked(query).mockResolvedValue([{
      plan_id: 1, plan_codigo: "PLAN-1", fecha_plan: "2026-09-01", cliente_nombre: "Acme",
      tarifa_comercial: "1000.00", costo_operativo: "300.00", total_gastos: "150.00", total_viaticos: "100.00",
    }] as never);
    const [f] = await reporteRentabilidadPorViaje(7);
    expect(f).toMatchObject({
      tarifaComercial: 1000, costoOperativo: 300, gastos: 150, viaticos: 100, utilidad: 450,
    });
  });

  it("costo operativo null (viaje sin ruta con costo capturado) no rompe el cálculo", async () => {
    vi.mocked(query).mockResolvedValue([{
      plan_id: 1, plan_codigo: "PLAN-1", fecha_plan: "2026-09-01", cliente_nombre: null,
      tarifa_comercial: "1000.00", costo_operativo: null, total_gastos: "0.00", total_viaticos: "0.00",
    }] as never);
    const [f] = await reporteRentabilidadPorViaje(7);
    expect(f.costoOperativo).toBeNull();
    expect(f.utilidad).toBe(1000);
  });
});

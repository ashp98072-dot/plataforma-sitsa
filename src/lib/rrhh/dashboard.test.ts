import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { obtenerResumenGerencial, obtenerEstadisticasDashboard } from "./dashboard";
const rows = (data: Record<string, unknown>[]) => data as RowDataPacket[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-28T12:00:00Z"));
  vi.mocked(query).mockImplementation(async (sql) => {
    if (sql.includes("rrhh_planilla_lineas")) return rows([{ total: "1800.50", costo_registrado: "2250.75" }]);
    if (sql.includes("rrhh_bitacora_legal")) return rows([{ tipo: "Amonestacion", total: 3 }]);
    return rows([{ total: 2 }]);
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("dashboard mensual RRHH", () => {
  it("consultas de altas y bitácora fallidas no aparentan cero registros", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(query).mockRejectedValue(new Error("fallo"));
    const [r] = await obtenerResumenGerencial(7, 1);
    expect(r.altas).toBeNull(); expect(r.bajas).toBeNull();
    expect(r.amonestaciones).toBeNull(); expect(r.suspensiones).toBeNull(); expect(r.despidos).toBeNull();
  });
  it("estadísticas diarias fallidas no se convierten en ceros", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(query).mockRejectedValue(new Error("fallo"));
    await expect(obtenerEstadisticasDashboard(7)).rejects.toThrow("no disponibles");
  });
  it("separa neto y costo registrado conservando campos e indicadores anteriores", async () => {
    const [r] = await obtenerResumenGerencial(7, 1);
    expect(r).toEqual({ mes: "2026-08", altas: 2, bajas: 2, costoNomina: 1800.5,
      netoNomina: 1800.5, costoRegistrado: 2250.75, amonestaciones: 3, suspensiones: 0, despidos: 0 });
  });
  it("solo agrega períodos cerrados/pagados de la misma empresa, por inicio", async () => {
    await obtenerResumenGerencial(7, 1);
    const llamada = vi.mocked(query).mock.calls.find(([sql]) => sql.includes("rrhh_planilla_lineas"))!;
    expect(llamada[0]).toContain("p.estado IN ('Cerrada', 'Pagada')");
    expect(llamada[0]).toContain("l.empresa_id = ? AND p.empresa_id = ?");
    expect(llamada[0]).toContain("p.fecha_inicio BETWEEN ? AND ?");
    expect(llamada[1]).toEqual([7, 7, "2026-08-01", "2026-08-31"]);
    expect(llamada[0]).toContain("SUM(l.neto)");
    expect(llamada[0]).toContain("COALESCE(l.igss_patronal, 0)");
    for (const campo of ["sueldo_base", "bono_incentivo", "bono_herramientas", "otros_ingresos"]) {
      expect(llamada[0]).toContain(`COALESCE(l.${campo}, 0)`);
    }
    // Las retenciones no son un costo patronal adicional ni reducen el ingreso bruto.
    expect(llamada[0]).not.toMatch(/l\.(descuentos|igss_laboral|isr)/);
  });
  it("un mes sin nómina es cero, no un error", async () => {
    vi.mocked(query).mockResolvedValue(rows([{ total: 0, costo_registrado: 0 }]));
    const [r] = await obtenerResumenGerencial(7, 1);
    expect(r.netoNomina).toBe(0);
    expect(r.costoRegistrado).toBe(0);
  });
  it("un fallo de consulta no se muestra como cero en los nuevos indicadores", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(query).mockImplementation(async (sql) => {
      if (sql.includes("rrhh_planilla_lineas")) throw new Error("database unavailable");
      return rows([{ total: 2 }]);
    });
    const [r] = await obtenerResumenGerencial(7, 1);
    expect(r.netoNomina).toBeNull();
    expect(r.costoRegistrado).toBeNull();
    expect(r.altas).toBe(2);
    expect(r.bajas).toBe(2);
  });
  it("respeta el mes de Guatemala cuando el servidor UTC ya cambió de mes", async () => {
    vi.setSystemTime(new Date("2026-09-01T02:00:00Z"));
    const meses = await obtenerResumenGerencial(7, 2);
    expect(meses.map((r) => r.mes)).toEqual(["2026-07", "2026-08"]);
  });
  it("respeta febrero bisiesto y cruce de año", async () => {
    vi.setSystemTime(new Date("2024-02-20T12:00:00Z"));
    const meses = await obtenerResumenGerencial(7, 3);
    expect(meses.map((r) => r.mes)).toEqual(["2023-12", "2024-01", "2024-02"]);
    const llamadas = vi.mocked(query).mock.calls.filter(([sql]) => sql.includes("rrhh_planilla_lineas"));
    expect(llamadas[2][1]).toEqual([7, 7, "2024-02-01", "2024-02-29"]);
    expect(vi.mocked(query).mock.calls.every(([sql]) => sql.trimStart().startsWith("SELECT"))).toBe(true);
  });
});

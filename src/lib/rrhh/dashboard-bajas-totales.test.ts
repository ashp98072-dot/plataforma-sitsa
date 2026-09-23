import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { obtenerEstadisticasDashboard, obtenerDetalleMovimientosMensual } from "./dashboard";

/**
 * RRHH-DASHBOARD-BAJAS-FOTO-1 — "Empleados de baja" = total ACTUAL de
 * empleados con estado = 'Baja'. NO es "Bajas del mes seleccionado" (esas se
 * cuentan por fecha_egreso del mes y siguen exactamente igual). Modelo
 * reutilizado: tabla `empleados`, campo `estado`. Sin tablas/columnas nuevas.
 */
type Fila = { empresa_id: number; estado: string; fecha_egreso?: string };
let empleados: Fila[] = [];

/** Emula solo los COUNT(*) FROM empleados del dashboard (los demás indicadores devuelven 0). */
function emular(sql: string, params: unknown[]): RowDataPacket[] {
  const empresa = params[0];
  const m = String(sql).match(/FROM empleados\s+WHERE empresa_id = \? AND estado = '(\w+)'/);
  if (m) return [{ total: empleados.filter((e) => e.empresa_id === empresa && e.estado === m[1]).length }] as RowDataPacket[];
  return [{ total: 0 }] as RowDataPacket[];
}

beforeEach(() => {
  vi.resetAllMocks();
  empleados = [
    ...Array.from({ length: 4 }, () => ({ empresa_id: 7, estado: "Activo" })),
    ...Array.from({ length: 3 }, () => ({ empresa_id: 7, estado: "Baja", fecha_egreso: "2024-01-15" })), // bajas ANTIGUAS: no son del mes
    { empresa_id: 7, estado: "Baja", fecha_egreso: "2026-08-10" },
    ...Array.from({ length: 9 }, () => ({ empresa_id: 8, estado: "Activo" })),
    ...Array.from({ length: 5 }, () => ({ empresa_id: 8, estado: "Baja" })),
  ];
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => emular(sql, params)) as never);
});

describe("obtenerEstadisticasDashboard — Activos y Bajas ACTUALES", () => {
  it("totalEmpleados sigue contando SOLO Activos", async () => {
    expect((await obtenerEstadisticasDashboard(7)).totalEmpleados).toBe(4);
  });

  it("totalBajas cuenta SOLO estado = 'Baja' (incluye bajas de cualquier fecha, no solo las del mes)", async () => {
    expect((await obtenerEstadisticasDashboard(7)).totalBajas).toBe(4);
  });

  it("aislamiento por empresa: cada empresa ve sus propios totales", async () => {
    const otra = await obtenerEstadisticasDashboard(8);
    expect([otra.totalEmpleados, otra.totalBajas]).toEqual([9, 5]);
    const propia = await obtenerEstadisticasDashboard(7);
    expect([propia.totalEmpleados, propia.totalBajas]).toEqual([4, 4]);
  });

  it("la consulta de bajas va acotada por empresa_id, usa estado = 'Baja' y NUNCA fecha_egreso ni movimientos", async () => {
    await obtenerEstadisticasDashboard(7);
    const llamada = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("estado = 'Baja'"))!;
    expect(llamada[0]).toContain("FROM empleados");
    expect(llamada[0]).toContain("empresa_id = ?");
    expect(llamada[0]).not.toContain("fecha_egreso");
    expect(llamada[1]).toEqual([7]);
  });

  it("los demás indicadores no cambian: sigue habiendo una consulta de Activos y las de hoy con e.estado = 'Activo'", async () => {
    await obtenerEstadisticasDashboard(7);
    const sqls = vi.mocked(query).mock.calls.map(([sql]) => String(sql));
    expect(sqls.filter((s) => /FROM empleados\s+WHERE empresa_id = \? AND estado = 'Activo'/.test(s))).toHaveLength(1);
    expect(sqls.filter((s) => s.includes("e.estado = 'Activo'")).length).toBeGreaterThanOrEqual(4);
  });

  it("devuelve todos los campos anteriores más totalBajas (compatible)", async () => {
    expect(Object.keys(await obtenerEstadisticasDashboard(7)).sort()).toEqual(
      ["ausentesHoy", "enVacaciones", "otrasIncidenciasHoy", "presentesHoy", "totalBajas", "totalEmpleados"],
    );
  });

  it("un fallo de la consulta de bajas usa el mismo manejo seguro que el resto (mensaje genérico, sin SQL)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(query).mockRejectedValue(new Error("SQL privado"));
    await expect(obtenerEstadisticasDashboard(7)).rejects.toThrow("Estadísticas de hoy no disponibles.");
  });
});

describe("bajas ACTUALES ≠ bajas del mes", () => {
  it("el detalle mensual sigue usando estado='Baja' Y fecha_egreso del mes (sin cambios) — distinto del total actual", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await obtenerDetalleMovimientosMensual(7, "2026-08");
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("estado = 'Baja' AND fecha_egreso BETWEEN ? AND ?");
  });

  it("con 4 empleados de baja en total y 1 baja en el mes, ambos indicadores conviven: total actual 4, del mes 1", async () => {
    const totalActual = (await obtenerEstadisticasDashboard(7)).totalBajas;
    const delMes = empleados.filter((e) => e.empresa_id === 7 && e.estado === "Baja" && (e.fecha_egreso ?? "") >= "2026-08-01" && (e.fecha_egreso ?? "") <= "2026-08-31").length;
    expect([totalActual, delMes]).toEqual([4, 1]);
  });
});

describe("page.tsx del Dashboard RRHH — tarjetas", () => {
  const page = readFileSync("src/app/e/[slug]/dashboard-rrhh/page.tsx", "utf8").replace(/\r\n/g, "\n");

  it("la tarjeta 'Empleados de baja' muestra stats.totalBajas (estado actual), junto a 'Empleados activos' = stats.totalEmpleados", () => {
    expect(page).toContain('{ label: "Empleados activos", value: stats.totalEmpleados }');
    expect(page).toContain('{ label: "Empleados de baja", value: stats.totalBajas }');
    expect(page.indexOf("Empleados activos")).toBeLessThan(page.indexOf("Empleados de baja"));
  });

  it("solo aparece si el servidor devuelve totalBajas numérico (nunca inventa un 0)", () => {
    expect(page).toContain('typeof stats.totalBajas === "number"');
  });

  it("las tarjetas anteriores siguen (Presentes, Sin marcar hoy, En vacaciones, Otras incidencias) y 'Bajas del mes seleccionado' no cambia", () => {
    for (const label of ["Presentes (abiertos)", "Sin marcar hoy", "En vacaciones", "Otras incidencias", "Bajas del mes seleccionado"]) {
      expect(page).toContain(label);
    }
  });

  it("la cuadrícula soporta 6 tarjetas y sigue siendo responsive (2 / 3 / 6 columnas)", () => {
    expect(page).toContain("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6");
  });

  it("las tarjetas son informativas: RRHH > Empleados no recibe el estado por URL, así que no se inventó una navegación", () => {
    const empleadosPage = readFileSync("src/app/e/[slug]/rrhh/empleados/page.tsx", "utf8");
    expect(empleadosPage).not.toMatch(/searchParams\.get\("estado"\)/);
    expect(page).not.toContain("rrhh/empleados?estado");
  });

  it("no se creó ningún endpoint nuevo para esto: el dashboard sigue en GET /rrhh/dashboard", () => {
    const api = readFileSync("src/app/api/empresas/[slug]/rrhh/dashboard/route.ts", "utf8");
    expect(api).toContain("obtenerEstadisticasDashboard");
  });
});

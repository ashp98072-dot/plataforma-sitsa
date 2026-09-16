import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { obtenerDetalleMovimientosMensual } from "./dashboard";

beforeEach(() => vi.resetAllMocks());
const empleado = { id: 42, codigo: "E42", nombre: "Carlos Pineda", puesto: "Piloto", fecha_alta: "2026-09-01", fecha_egreso: "2026-09-30", estado: "Baja", es_alta: 1, es_baja_mes: 1 };
describe("detalle mensual RRHH", () => {
  it("altas por fecha conservan empleados actualmente en Baja", async () => {
    vi.mocked(query).mockResolvedValue([empleado] as unknown as RowDataPacket[]);
    const detalle = await obtenerDetalleMovimientosMensual(7, "2026-09");
    expect(detalle.altas[0]).toMatchObject({ id: 42, fechaAlta: "2026-09-01", esBaja: true });
    expect(vi.mocked(query).mock.calls[0][0]).toContain("(fecha_alta BETWEEN ? AND ?) AS es_alta");
  });
  it("bajas usan exactamente estado Baja y fecha de egreso del mes", async () => {
    vi.mocked(query).mockResolvedValue([empleado, { ...empleado, id: 43, es_baja_mes: 0 }] as unknown as RowDataPacket[]);
    expect((await obtenerDetalleMovimientosMensual(7, "2026-09")).bajas).toHaveLength(1);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("estado = 'Baja' AND fecha_egreso BETWEEN ? AND ?");
  });
  it("consulta única aislada por empresa y límites completos del mes", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await obtenerDetalleMovimientosMensual(7, "2024-02");
    expect(query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls[0][0]).toContain("FROM empleados WHERE empresa_id = ?");
    expect(vi.mocked(query).mock.calls[0][1]).toEqual(["2024-02-01", "2024-02-29", "2024-02-01", "2024-02-29", 7, "2024-02-01", "2024-02-29", "2024-02-01", "2024-02-29"]);
  });
  it("mes sin movimientos retorna listas vacías", async () => {
    vi.mocked(query).mockResolvedValue([]);
    expect(await obtenerDetalleMovimientosMensual(7, "2026-09")).toEqual({ mes: "2026-09", altas: [], bajas: [] });
  });
  it("rechaza meses inválidos sin consultar DB y no oculta errores", async () => {
    await expect(obtenerDetalleMovimientosMensual(7, "2026-13")).rejects.toThrow("Mes inválido");
    expect(query).not.toHaveBeenCalled();
    vi.mocked(query).mockRejectedValue(new Error("DB"));
    await expect(obtenerDetalleMovimientosMensual(7, "2026-09")).rejects.toThrow("DB");
  });
  it("sin fotografía no excluye al empleado del detalle", async () => {
    vi.mocked(query).mockResolvedValue([empleado] as unknown as RowDataPacket[]);
    expect((await obtenerDetalleMovimientosMensual(7, "2026-09")).altas).toHaveLength(1);
    const ui = readFileSync("src/components/rrhh/detalle-movimientos-mensual.tsx", "utf8");
    expect(ui).toContain("rounded-full");
    expect(ui).toContain("onError={() => setFallida(true)}");
    expect(ui).toContain("Sin fotografía de");
    expect(ui).toContain("/empleados/${persona.id}/foto");
  });
  it("Baja mantiene enlace directo a ficha e historial sin filtro Activo", () => {
    const ui = readFileSync("src/components/rrhh/detalle-movimientos-mensual.tsx", "utf8");
    expect(ui).toContain("Ver ficha e histórico");
    expect(ui).toContain("?empleado=${persona.id}");
    const ficha = readFileSync("src/app/e/[slug]/rrhh/empleados/page.tsx", "utf8");
    expect(ficha).toContain("/empleados/${id}?historial=1");
    expect(ficha).toContain("abrirFichaDesdeDashboard(data.empleado, data.historial");
  });
  it("endpoint aplica permisos antes de detalle y selección mensual usa botón accesible", () => {
    const api = readFileSync("src/app/api/empresas/[slug]/rrhh/dashboard/route.ts", "utf8");
    expect(api.indexOf('requireTenantRrhh(slug, "empleados", "ver")')).toBeLessThan(api.indexOf("obtenerDetalleMovimientosMensual(guard.empresa.id, mes)"));
    const ui = readFileSync("src/app/e/[slug]/dashboard-rrhh/page.tsx", "utf8");
    expect(ui).toContain('type="button" aria-controls="detalle-movimientos"');
    expect(ui).toContain("setMesDetalle(r.mes)");
  });
});

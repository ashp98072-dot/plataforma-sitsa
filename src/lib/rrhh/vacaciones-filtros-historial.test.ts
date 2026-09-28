import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query, execute: vi.fn() }));
vi.mock("./evidencias", () => ({ contarEvidenciasPorIncidencia: vi.fn(async () => new Map()) }));
import { listarVacaciones } from "./vacaciones";

beforeEach(() => { vi.resetAllMocks(); m.query.mockResolvedValue([]); });

describe("RRHH Vacaciones — filtros independientes del historial", () => {
  it("1) sin filtros -> solo acota por empresa_id (todos los registros de la empresa)", async () => {
    await listarVacaciones(7);
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain("WHERE i.empresa_id = ?");
    expect(params).toEqual([7, null, null, null, null, null, null, null, null]);
  });
  it("2) filtro empleado -> solo ese colaborador", async () => {
    await listarVacaciones(7, { empleadoId: 55 });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain("i.id_empleado = ?");
    expect(params).toEqual([7, 55, 55, null, null, null, null, null, null]);
  });
  it("3) filtro tipo", async () => {
    await listarVacaciones(7, { tipo: "Vacaciones" });
    const [sql, params] = m.query.mock.calls[0];
    expect(sql).toContain("i.tipo = ?");
    expect(params).toContain("Vacaciones");
  });
  it("4) filtro desde", async () => {
    await listarVacaciones(7, { desde: "2026-01-01" });
    const [, params] = m.query.mock.calls[0];
    expect(params).toContain("2026-01-01");
  });
  it("5) filtro hasta", async () => {
    await listarVacaciones(7, { hasta: "2026-12-31" });
    const [, params] = m.query.mock.calls[0];
    expect(params).toContain("2026-12-31");
  });
  it("6) rango desde/hasta", async () => {
    await listarVacaciones(7, { desde: "2026-01-01", hasta: "2026-06-30" });
    const [, params] = m.query.mock.calls[0];
    expect(params).toEqual([7, null, null, null, null, "2026-01-01", "2026-01-01", "2026-06-30", "2026-06-30"]);
  });
  it("7) combinación empleado + tipo", async () => {
    await listarVacaciones(7, { empleadoId: 55, tipo: "IGSS" });
    const [, params] = m.query.mock.calls[0];
    expect(params).toEqual([7, 55, 55, "IGSS", "IGSS", null, null, null, null]);
  });
  it("8) combinación empleado + tipo + fechas", async () => {
    await listarVacaciones(7, { empleadoId: 55, tipo: "IGSS", desde: "2026-01-01", hasta: "2026-06-30" });
    const [, params] = m.query.mock.calls[0];
    expect(params).toEqual([7, 55, 55, "IGSS", "IGSS", "2026-01-01", "2026-01-01", "2026-06-30", "2026-06-30"]);
  });
  it("9) empresa A no ve empresa B: empresa_id siempre es el primer parámetro fijo", async () => {
    await listarVacaciones(9, { empleadoId: 55 });
    expect(m.query.mock.calls[0][1][0]).toBe(9);
  });
  it("orden: fecha_inicio DESC, id DESC", async () => {
    await listarVacaciones(7);
    expect(m.query.mock.calls[0][0]).toContain("ORDER BY i.fecha_inicio DESC, i.id DESC");
  });
});

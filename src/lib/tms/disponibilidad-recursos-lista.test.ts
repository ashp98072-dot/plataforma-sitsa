import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { listarConflictosPersonal, listarConflictosUnidades } from "./disponibilidad-recursos-lista";

/**
 * PROGRAMACION-DISPONIBILIDAD-BUSCADORES-1 — la versión EN LOTE reutiliza
 * el mismo motor de ocupación real (intervaloOcupacionReal/
 * seSolapaConOcupacionReal, ya probado en disponibilidad-regreso-
 * opcional.test.ts) — estas pruebas se enfocan en lo NUEVO: agrupar varias
 * filas SQL por recurso (empleado_id / placa) y devolver solo el primero
 * que realmente choca, nunca uno que no se traslapa en hora.
 */

function filaPersonal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    empleado_id: 10,
    plan_id: 1,
    codigo: "PLAN-000001",
    estado: "Programado",
    inicio: "2026-09-22 08:00:00",
    regreso_estimado: "2026-09-22 11:00:00",
    llegada_tecnica: 0,
    hora_llegada: null,
    cerrado_en: null,
    ...overrides,
  };
}

function filaUnidad(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    placa: "P-123ABC",
    plan_id: 1,
    codigo: "PLAN-000001",
    estado: "Programado",
    inicio: "2026-09-22 08:00:00",
    regreso_estimado: "2026-09-22 11:00:00",
    llegada_tecnica: 0,
    hora_llegada: null,
    cerrado_en: null,
    ...overrides,
  };
}

const INTERVALO_9_10 = { inicio: "2026-09-22 09:00:00", fin: "2026-09-22 10:00:00" };
const INTERVALO_14_17 = { inicio: "2026-09-22 14:00:00", fin: "2026-09-22 17:00:00" };

beforeEach(() => vi.resetAllMocks());

describe("listarConflictosPersonal", () => {
  it("un piloto con un plan que se traslapa aparece en el mapa, agrupado por empleado_id", async () => {
    vi.mocked(query).mockResolvedValue([filaPersonal({ empleado_id: 10 })] as never);
    const m = await listarConflictosPersonal(7, INTERVALO_9_10, null);
    expect(m.get(10)).toEqual({ planId: 1, planCodigo: "PLAN-000001", horaInicio: "2026-09-22 08:00:00", horaFin: "2026-09-22 11:00:00" });
  });

  it("un plan que NO se traslapa (mismo día, horas distintas) no marca al piloto como ocupado", async () => {
    // Viaje A 08:00-11:00 vs consulta 14:00-17:00 el mismo día -> sin conflicto (ejemplo del ticket).
    vi.mocked(query).mockResolvedValue([filaPersonal({ empleado_id: 10 })] as never);
    const m = await listarConflictosPersonal(7, INTERVALO_14_17, null);
    expect(m.has(10)).toBe(false);
  });

  it("varios empleados: solo el que realmente choca queda en el mapa (agrupación correcta por empleado_id)", async () => {
    vi.mocked(query).mockResolvedValue([
      filaPersonal({ empleado_id: 10 }), // 08:00-11:00, choca con 09:00-10:00
      filaPersonal({ empleado_id: 20, inicio: "2026-09-22 14:00:00", regreso_estimado: "2026-09-22 17:00:00" }), // no choca
    ] as never);
    const m = await listarConflictosPersonal(7, INTERVALO_9_10, null);
    expect(m.has(10)).toBe(true);
    expect(m.has(20)).toBe(false);
  });

  it("dos filas del mismo empleado (piloto en un plan, auxiliar en otro): toma el primer conflicto real, no las mezcla con otro empleado", async () => {
    vi.mocked(query).mockResolvedValue([
      filaPersonal({ empleado_id: 10, plan_id: 1, codigo: "PLAN-000001", inicio: "2026-09-22 14:00:00", regreso_estimado: "2026-09-22 17:00:00" }), // no choca
      filaPersonal({ empleado_id: 10, plan_id: 2, codigo: "PLAN-000002", inicio: "2026-09-22 08:00:00", regreso_estimado: "2026-09-22 11:00:00" }), // sí choca
    ] as never);
    const m = await listarConflictosPersonal(7, INTERVALO_9_10, null);
    expect(m.get(10)?.planCodigo).toBe("PLAN-000002");
  });

  it("sin excluirPlanId no agrega `p.id != ?`; con excluirPlanId sí, y viaja en los parámetros", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarConflictosPersonal(7, INTERVALO_9_10, null);
    let sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).not.toContain("p.id != ?");

    vi.mocked(query).mockClear();
    await listarConflictosPersonal(7, INTERVALO_9_10, 99);
    sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("p.id != ?");
    expect(vi.mocked(query).mock.calls[0][1]).toContain(99);
  });

  it("empresa_id viaja como primer parámetro (aislamiento multiempresa)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarConflictosPersonal(7, INTERVALO_9_10, null);
    expect(vi.mocked(query).mock.calls[0][1]?.[0]).toBe(7);
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("tp.empresa_id = ?");
    expect(sql).toContain("tp.id_empleado IS NOT NULL");
  });

  it("sin filas, devuelve un mapa vacío (nunca revienta)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const m = await listarConflictosPersonal(7, INTERVALO_9_10, null);
    expect(m.size).toBe(0);
  });
});

describe("listarConflictosUnidades", () => {
  it("una unidad con un plan que se traslapa aparece en el mapa, agrupada por placa en MAYÚSCULAS", async () => {
    vi.mocked(query).mockResolvedValue([filaUnidad({ placa: "p-123abc" })] as never);
    const m = await listarConflictosUnidades(7, INTERVALO_9_10, null);
    expect(m.get("P-123ABC")).toEqual({ planId: 1, planCodigo: "PLAN-000001", horaInicio: "2026-09-22 08:00:00", horaFin: "2026-09-22 11:00:00" });
  });

  it("una unidad sin traslape real no aparece en el mapa", async () => {
    vi.mocked(query).mockResolvedValue([filaUnidad()] as never);
    const m = await listarConflictosUnidades(7, INTERVALO_14_17, null);
    expect(m.has("P-123ABC")).toBe(false);
  });

  it("consulta contra tms_unidades/tms_planes_viaje.unidad_id, aislada por empresa_id", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarConflictosUnidades(7, INTERVALO_9_10, null);
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("FROM tms_unidades u");
    expect(sql).toContain("p.unidad_id = u.id");
    expect(sql).toContain("u.empresa_id = ?");
  });

  it("un viaje En ruta sin llegada técnica ocupa la unidad indefinidamente (fin=null), aunque el regreso_estimado haya vencido", async () => {
    vi.mocked(query).mockResolvedValue([
      filaUnidad({ estado: "En ruta", inicio: "2026-09-22 06:00:00", regreso_estimado: "2026-09-22 08:00:00", llegada_tecnica: 0 }),
    ] as never);
    const m = await listarConflictosUnidades(7, INTERVALO_9_10, null);
    expect(m.get("P-123ABC")?.horaFin).toBeNull();
  });

  it("una unidad Cancelada nunca ocupa (estado fuera de los candidatos)", async () => {
    // El SQL real filtraría esto por estado, pero se confirma que el mapeo tampoco lo agrega si llegara.
    vi.mocked(query).mockResolvedValue([filaUnidad({ estado: "Cancelado" })] as never);
    const m = await listarConflictosUnidades(7, INTERVALO_9_10, null);
    expect(m.has("P-123ABC")).toBe(false);
  });
});

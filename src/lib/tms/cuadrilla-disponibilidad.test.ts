import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { primerConflictoProgramacionIntervalo, listarOcupacionProgramacionIntervalo } from "./disponibilidad-programacion-intervalos";
const ventana = { fechaPlan: "2026-10-01", horaCarga: "08:00", regresoEstimado: "2026-10-01T10:00" };
const fila = (id: number, hora = "09:00:00", regreso = "2026-10-01 11:00:00") => ({ recurso_id: id, nombre: "Juan", plan_id: 40, codigo: "PLAN-40", fecha_plan: "2026-10-01", hora_carga: hora, regreso_estimado: regreso });
beforeEach(() => { vi.resetAllMocks(); vi.mocked(query).mockResolvedValue([]); });
describe("Cuadrilla en el motor compartido", () => {
  it.each(["piloto", "auxiliar", "cuadrilla"] as const)("interno contra reserva %s: bloquea solape", async () => {
    vi.mocked(query).mockResolvedValueOnce([fila(55)] as never);
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "cuadrilla", id: 55 }], ventana, [])).toMatchObject({ tipo: "cuadrilla", id: 55, planIdConflicto: 40 });
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("eq.id_empleado = e.id"); expect(sql).toContain("p.piloto_id = eq.id"); expect(sql).toContain("tms_plan_auxiliares"); expect(sql).toContain("tms_plan_cuadrilla");
  });
  it.each(["piloto", "auxiliar"] as const)("%s detecta reserva de cuadrilla por empleado, no por personal_id", async (tipo) => {
    vi.mocked(query).mockResolvedValueOnce([fila(100)] as never);
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo, id: 100 }], ventana, [])).not.toBeNull();
    expect(String(vi.mocked(query).mock.calls[0][0])).toContain("cq.id_empleado = tp.id_empleado");
  });
  it("secuenciales permitidos", async () => { vi.mocked(query).mockResolvedValueOnce([fila(55, "10:00:00")] as never); expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "cuadrilla", id: 55 }], ventana, [])).toBeNull(); });
  it("sin hora/regreso conserva reserva diaria", async () => { vi.mocked(query).mockResolvedValueOnce([fila(55, "18:00:00", "2026-10-01 19:00:00")] as never); expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "cuadrilla", id: 55 }], { ...ventana, horaCarga: null, regresoEstimado: null }, [])).not.toBeNull(); });
  it("cruce de medianoche detectado", async () => { vi.mocked(query).mockResolvedValueOnce([{ ...fila(55), fecha_plan: "2026-09-30", hora_carga: "22:00:00", regreso_estimado: "2026-10-01 09:00:00" }] as never); expect(await primerConflictoProgramacionIntervalo(7, [{ tipo: "cuadrilla", id: 55 }], ventana, [])).not.toBeNull(); });
  it("usa empresa, exclusión parametrizada y current-read transaccional", async () => {
    const q = vi.fn().mockResolvedValue([[]]); const conn = { query: q } as unknown as PoolConnection;
    await primerConflictoProgramacionIntervalo(7, [{ tipo: "cuadrilla", id: 55 }], ventana, [40], conn);
    expect(q.mock.calls[0][0]).toContain("p.empresa_id = ?"); expect(q.mock.calls[0][0]).toContain("p.id NOT IN (?)"); expect(q.mock.calls[0][0]).toMatch(/FOR UPDATE$/);
    expect(q.mock.calls[0][1][0]).toBe(7); expect(q.mock.calls[0][1].slice(-2)).toEqual([55, 40]);
  });
  it("externos nunca se pasan como recursos", async () => { expect(await primerConflictoProgramacionIntervalo(7, [], ventana, [])).toBeNull(); expect(query).not.toHaveBeenCalled(); });
  it("el buscador incluye internos sin fila tms_personal", async () => {
    vi.mocked(query).mockImplementation(async (sql) => String(sql).includes("FROM tms_plan_cuadrilla cq INNER") ? [fila(55)] as never : [] as never);
    expect((await listarOcupacionProgramacionIntervalo(7, ventana, [])).personal.get(55)).toMatchObject({ planId: 40 });
  });
  it("tercerizado reserva el empleado de cuadrilla en el buscador, sin reservar su unidad/TC/piloto históricos", async () => {
    vi.mocked(query).mockImplementation(async (sql) => String(sql).includes("FROM tms_plan_cuadrilla cq INNER") ? [fila(55)] as never : [] as never);
    const ocupacion = await listarOcupacionProgramacionIntervalo(7, ventana, []);
    expect(ocupacion.personal.has(55)).toBe(true); expect(ocupacion.unidades.size).toBe(0); expect(ocupacion.tcs.size).toBe(0);
    const consultas = vi.mocked(query).mock.calls.map(([sql]) => String(sql));
    const cuadrilla = consultas.find((sql) => sql.includes("FROM tms_plan_cuadrilla cq INNER"))!;
    expect(cuadrilla).toContain("cq.tipo = 'INTERNO'"); expect(cuadrilla).not.toContain("<> 'Tercerizado'");
    consultas.filter((sql) => !sql.includes("FROM tms_plan_cuadrilla cq INNER")).forEach((sql) => expect(sql).toContain("<> 'Tercerizado'"));
  });
  it.each(["piloto", "auxiliar", "cuadrilla"] as const)("%s detecta cuadrilla interna de tercerizado sin filtrar ese viaje", async (tipo) => {
    vi.mocked(query).mockResolvedValueOnce([fila(55)] as never);
    expect(await primerConflictoProgramacionIntervalo(7, [{ tipo, id: 55 }], ventana, [])).not.toBeNull();
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("cq.tipo = 'INTERNO'");
    expect(sql).toMatch(/OR EXISTS \(SELECT 1 FROM tms_plan_cuadrilla|AND \(EXISTS \(SELECT 1 FROM tms_plan_cuadrilla/);
    // Solo el lado de piloto/auxiliar se limita a Propio; el WHERE común no.
    expect(sql.slice(sql.lastIndexOf("WHERE p.empresa_id"))).not.toContain("<> 'Tercerizado'");
    expect((sql.match(/\(/g) ?? []).length).toBe((sql.match(/\)/g) ?? []).length);
  });
  it("tercerizado sin internos/solo externos no tiene candidatos ni recursos a validar", async () => {
    expect(await primerConflictoProgramacionIntervalo(7, [], ventana, [])).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect((await listarOcupacionProgramacionIntervalo(7, ventana, [])).personal.size).toBe(0);
  });
});

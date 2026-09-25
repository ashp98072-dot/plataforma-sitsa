import { describe, expect, it, vi } from "vitest";

vi.mock("./descuentos", () => ({ finalizarSiCorresponde: vi.fn() }));
vi.mock("./planilla-faltas", () => ({ obtenerFaltasPlanilla: vi.fn(async () => new Map()) }));

import { obtenerConceptosPendientes } from "./planilla-conceptos";

/**
 * RRHH PLANILLAS — las horas extra NO se prorratean: son ingreso REAL. Entran solo si están aprobadas, son del empleado,
 * caen dentro del período y no están aplicadas/reservadas en otra planilla. Regenerar no las duplica (solo lectura).
 */
const periodo = { id: 5, fechaInicio: "2026-09-01", fechaFin: "2026-09-15" };
const he = (id: number, over: Record<string, unknown> = {}) => ({ id, id_empleado: 7, fecha: "2026-09-03", estado: "APROBADA", planilla_periodo_id: null, monto: 150, horas: 4, motivo: "", ...over });

function conexion(horas: Record<string, unknown>[]) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM horas_extra_registros")) return [horas, []];
      return [[], []];
    }),
  };
}
const horasDe = async (horas: Record<string, unknown>[], empleado = 7) =>
  (await obtenerConceptosPendientes(conexion(horas) as never, 3, periodo)).get(empleado)?.horasExtra ?? [];

describe("horas extra en planilla", () => {
  it("25) una HE aprobada dentro del período se incluye por su monto REAL (sin prorrateo)", async () => {
    const r = await horasDe([he(1)]);
    expect(r).toEqual([{ id: 1, monto: 150, horas: 4, concepto: "Horas extra", fecha: "2026-09-03", notas: "" }]);
  });
  it("26) una HE fuera del período no entra (antes o después)", async () => {
    expect(await horasDe([he(1, { fecha: "2026-08-31" }), he(2, { fecha: "2026-09-16" })])).toEqual([]);
  });
  it("solo APROBADA y del empleado: pendiente/rechazada/ya aplicada no cuentan y cada quien recibe las suyas", async () => {
    const filas = [he(1), he(2, { estado: "PENDIENTE" }), he(3, { estado: "RECHAZADA" }), he(4, { estado: "APLICADA_EN_PLANILLA" }), he(5, { id_empleado: 8 })];
    expect((await horasDe(filas, 7)).map((h) => h.id)).toEqual([1]);
    expect((await horasDe(filas, 8)).map((h) => h.id)).toEqual([5]);
  });
  it("no incluye horas reservadas/aplicadas en OTRA planilla (planilla_periodo_id distinto de NULL)", async () => {
    expect(await horasDe([he(1, { planilla_periodo_id: 99 })])).toEqual([]);
  });
  it("27) regenerar no duplica: la lectura es pura, dos lecturas seguidas dan lo mismo", async () => {
    const c = conexion([he(1)]);
    const a = await obtenerConceptosPendientes(c as never, 3, periodo);
    const b = await obtenerConceptosPendientes(c as never, 3, periodo);
    expect(a.get(7)?.horasExtra).toEqual(b.get(7)?.horasExtra);
    expect(a.get(7)?.horasExtra).toHaveLength(1);
    expect(c.query.mock.calls.every(([sql]) => !/^\s*(UPDATE|INSERT|DELETE)/i.test(String(sql)))).toBe(true); // solo LECTURA
  });
  it("las horas ya aplicadas a ESTE período requieren revisión explícita (no se liberan ni duplican)", async () => {
    await expect(horasDe([he(1, { planilla_periodo_id: 5, estado: "APLICADA_EN_PLANILLA" })])).rejects.toThrow("conceptos históricos ya aplicados");
  });
});

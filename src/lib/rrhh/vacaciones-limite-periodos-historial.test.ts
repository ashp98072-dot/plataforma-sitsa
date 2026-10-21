import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const m = await import("./vacaciones-registro-bd.testutil");
  return {
    query: (sql: string, p?: unknown[]) => m.bd.consulta(sql, p),
    execute: async () => { throw new Error("no usar execute del pool"); },
    getPool: () => ({ getConnection: async () => m.bd.conexion() }),
  };
});

import { bd, EMPRESA } from "./vacaciones-registro-bd.testutil";
import { obtenerHistorialPeriodos } from "./vacaciones";
import { previsualizarRegistro, registrarVacaciones } from "./vacaciones-registro";
import { calcularDiasAcumuladosProporcional, deIso, MAX_PERIODOS_VIGENTES } from "./vacaciones-periodos";
import { reconstruirEmpleado } from "./vacaciones-reconstruccion";

/**
 * CONCLUSIÓN: El límite MAX_PERIODOS_VIGENTES = 2 NO impide registrar ni reconstruir vacaciones históricas. Los períodos históricos permanecen en BD y el
 * consumo se evalúa según la disponibilidad existente en la fecha histórica. El límite de 2 períodos y el tope de 30 aplican al saldo utilizable según la
 * fecha evaluada, no eliminan el historial.
 *
 * ¿El límite de 2 períodos vigentes (MAX_PERIODOS_VIGENTES = 2) impide cargar vacaciones históricas? NO. Se separan tres conceptos:
 *   1) períodos históricos EXISTENTES en BD (todos, también los vencidos);
 *   2) períodos UTILIZABLES en la fecha de la vacación histórica (el motor cronológico los evalúa a ESA fecha, no a hoy);
 *   3) saldo UTILIZABLE ACTUAL (solo los vigentes de hoy, ≤ 30).
 * Caso sintético: fecha_alta 13/04/2020, "hoy" 08/10/2026 ⇒ 7 períodos (2020-21 … 2026-27); hoy solo 5, 6 y 7 son utilizables.
 */
const EMP = 1;
const ALTA = "2020-04-13";
const HOY = new Date(2026, 9, 8);
const r2 = (n: number) => Math.round(n * 100) / 100;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 8, 12)); bd.reiniciar({ empleados: [{ id: EMP, empresa_id: EMPRESA, nombre: "Colaborador Sintético", fecha_alta: ALTA }] }); });
afterEach(() => vi.useRealTimers());

const periodos = () => bd.t.saldos.filter((s) => s.id_empleado === EMP).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));
const anioDe = (incidenciaId: number) => bd.t.detalle.filter((d) => d.incidencia_id === incidenciaId).map((d) => [periodos().find((s) => s.id === d.saldo_id)!.anio_laboral, d.dias_tomados]);
const reg = (inicio: string, fin: string, dias: number) => registrarVacaciones({ empresaId: EMPRESA, idEmpleado: EMP, fechaInicio: inicio, fechaFin: fin, diasATomar: dias, tipo: "Vacaciones", usuario: "rrhh.ana" });

describe("Registro histórico con el límite de 2 períodos vigentes INTACTO", () => {
  it("el límite sigue siendo 2 y la serie completa (también los períodos vencidos) permanece en BD; el saldo actual solo cuenta los vigentes (≤ 30)", async () => {
    expect(MAX_PERIODOS_VIGENTES).toBe(2);
    const h = await obtenerHistorialPeriodos(EMPRESA, EMP);
    expect(h.periodos.map((p) => [p.anioLaboral, p.periodoInicio, p.periodoFin, p.estado])).toEqual([
      [1, "2020-04-13", "2021-04-12", "Vencido"], [2, "2021-04-13", "2022-04-12", "Vencido"], [3, "2022-04-13", "2023-04-12", "Vencido"], [4, "2023-04-13", "2024-04-12", "Vencido"],
      [5, "2024-04-13", "2025-04-12", "Vigente"], [6, "2025-04-13", "2026-04-12", "Vigente"], [7, "2026-04-13", "2027-04-12", "Vigente"],
    ]);
    expect(h.saldoActual).toBe(30);
    expect(h.requiereReparacion).toBe(false);
  });

  it("10/08/2021: consume del año 1 (el que correspondía en esa fecha) aunque HOY esté vencido; es un registro histórico", async () => {
    await obtenerHistorialPeriodos(EMPRESA, EMP);
    const pv = await previsualizarRegistro(EMPRESA, EMP, "2021-08-10", "2021-08-12", 3);
    expect(pv.esHistorico).toBe(true);
    expect(pv.plan!.deficit).toBe(0);
    expect(pv.plan!.tramos[0].asignaciones).toEqual([expect.objectContaining({ anioLaboral: 1, dias: 3, estadoHoy: "Vencido", libreAntes: 15 })]);
    const r = await reg("2021-08-10", "2021-08-12", 3);
    expect(r).toMatchObject({ ok: true, historico: true });
    expect(anioDe(bd.t.incidencias[0].id)).toEqual([[1, 3]]);
  });

  it("10/08/2023: aplica FIFO según los períodos de ESA fecha (años 2 y 3 completos más recientes y el 4 en curso; el año 1 ya había vencido)", async () => {
    await obtenerHistorialPeriodos(EMPRESA, EMP);
    const pv = await previsualizarRegistro(EMPRESA, EMP, "2023-08-10", "2023-08-12", 3);
    expect(pv.esHistorico).toBe(true);
    const libres = pv.plan!.tramos[0].disponiblePorPeriodo.map((d) => d.anioLaboral);
    expect(libres).toEqual([2, 3, 4]); // el año 1 NO era utilizable en agosto de 2023; el 4 estaba en curso
    expect(pv.plan!.tramos[0].asignaciones).toEqual([expect.objectContaining({ anioLaboral: 2, dias: 3 })]); // FIFO: el más antiguo utilizable
    expect(pv.plan!.deficit).toBe(0);
    expect((await reg("2023-08-10", "2023-08-12", 3)).ok).toBe(true);
    expect(anioDe(bd.t.incidencias[0].id)).toEqual([[2, 3]]);
  });

  it("con ambas cargadas: nada reaparece como disponible, los períodos viejos siguen en BD y el saldo ACTUAL no cambia (el consumo histórico no toca lo vigente de hoy)", async () => {
    const antes = await obtenerHistorialPeriodos(EMPRESA, EMP);
    const vigentesAntes = periodos().filter((s) => s.estado === "Vigente").map((s) => [s.anio_laboral, s.dias_disponibles]);
    await reg("2021-08-10", "2021-08-12", 3);
    await reg("2023-08-10", "2023-08-12", 3);
    const despues = await obtenerHistorialPeriodos(EMPRESA, EMP);
    expect(despues.periodos).toHaveLength(7);
    expect(despues.saldoActual).toBe(antes.saldoActual);
    expect(periodos().filter((s) => s.estado === "Vigente").map((s) => [s.anio_laboral, s.dias_disponibles])).toEqual(vigentesAntes);
    // el consumo vive en los períodos vencidos de su fecha y NO reaparece como disponible
    for (const [anio, consumido] of [[1, 3], [2, 3]] as const) {
      const p = periodos().find((s) => s.anio_laboral === anio)!;
      expect(p).toMatchObject({ estado: "Vencido", dias_otorgados: 15, dias_disponibles: 0 });
      expect(bd.t.detalle.filter((d) => d.saldo_id === p.id).reduce((s, d) => s + d.dias_tomados, 0)).toBe(consumido);
    }
    expect(r2(bd.t.detalle.reduce((s, d) => s + d.dias_tomados, 0))).toBe(6);
    expect(periodos().filter((s) => s.estado === "Vigente").reduce((s, p) => s + p.dias_disponibles, 0)).toBeLessThanOrEqual(30);
    expect(bd.t.empleados[0].fecha_alta).toBe(ALTA); // fecha_alta sigue siendo la base
  });

  it("la acumulación en curso a esa fecha usa la fórmula existente (domingos excluidos): el año 2 acumulaba lo que dice calcularDiasAcumuladosProporcional el 10/08/2021", async () => {
    await obtenerHistorialPeriodos(EMPRESA, EMP);
    const pv = await previsualizarRegistro(EMPRESA, EMP, "2021-08-10", "2021-08-12", 3);
    const esperado = calcularDiasAcumuladosProporcional(deIso("2021-04-13"), deIso("2022-04-12"), deIso("2021-08-10"), 15);
    expect(pv.plan!.tramos[0].disponiblePorPeriodo.find((d) => d.anioLaboral === 2)!.libre).toBe(esperado);
  });

  it("el tope de 30 ACTUAL no interfiere: cargar historia en cualquier orden da el mismo resultado", async () => {
    await obtenerHistorialPeriodos(EMPRESA, EMP);
    await reg("2023-08-10", "2023-08-12", 3);
    await reg("2021-08-10", "2021-08-12", 3);
    const a = bd.t.detalle.map((d) => [bd.t.incidencias.find((i) => i.id === d.incidencia_id)!.fecha_inicio, periodos().find((s) => s.id === d.saldo_id)!.anio_laboral, d.dias_tomados]).sort();
    expect(a).toEqual([["2021-08-10", 1, 3], ["2023-08-10", 2, 3]]);
  });
});

describe("fecha_alta es la ÚNICA base de los períodos", () => {
  it("una fecha_inicio_laboral distinta NO se usa: los períodos y el consumo salen de fecha_alta (solo se advierte)", () => {
    const r = reconstruirEmpleado(
      { id: EMP, codigo: "E-1", nombre: "Colaborador Sintético", fechaAlta: ALTA, fechaInicioLaboral: "2018-01-01" },
      [{ origen: 1, inicio: "2021-08-10", fin: "2021-08-12", dias: 3, tipo: "Vacaciones" }],
      HOY,
    );
    expect(r.periodos.map((p) => [p.anioLaboral, p.inicio, p.fin]).slice(0, 2)).toEqual([[1, "2020-04-13", "2021-04-12"], [2, "2021-04-13", "2022-04-12"]]);
    expect(r.consumos.map((c) => [c.anioLaboral, c.dias])).toEqual([[1, 3]]);
  });
  it("la serie guardada se deriva de fecha_alta y NO de la fecha de la vacación ni de la de hoy", async () => {
    await obtenerHistorialPeriodos(EMPRESA, EMP);
    await reg("2021-08-10", "2021-08-12", 3);
    expect(periodos().map((s) => s.periodo_inicio)).toEqual(["2020-04-13", "2021-04-13", "2022-04-13", "2023-04-13", "2024-04-13", "2025-04-13", "2026-04-13"]);
  });
});

describe("La simulación de la importación histórica (motor cronológico) llega al mismo resultado", () => {
  it("reconstruirEmpleado: conserva los 7 períodos, consume a la fecha de cada vacación y el saldo final solo cuenta los vigentes", () => {
    const r = reconstruirEmpleado(
      { id: EMP, codigo: "E-1", nombre: "Colaborador Sintético", fechaAlta: ALTA, fechaInicioLaboral: null },
      [{ origen: 1, inicio: "2021-08-10", fin: "2021-08-12", dias: 3, tipo: "Vacaciones" }, { origen: 2, inicio: "2023-08-10", fin: "2023-08-12", dias: 3, tipo: "Vacaciones" }],
      HOY,
    );
    expect(r.bloqueado).toBeNull();
    expect(r.periodos.map((p) => [p.anioLaboral, p.estado])).toEqual([[1, "Vencido"], [2, "Vencido"], [3, "Vencido"], [4, "Vencido"], [5, "Vigente"], [6, "Vigente"], [7, "Vigente"]]);
    expect(r.consumos.map((c) => [c.anioLaboral, c.dias])).toEqual([[1, 3], [2, 3]]);
    expect(r.periodos.find((p) => p.anioLaboral === 1)).toMatchObject({ consumidos: 3, disponibles: 0 });
    expect(r.saldoFinal).toBe(30);
    expect(r.vacaciones.map((v) => [v.consumido, v.deficit])).toEqual([[3, 0], [3, 0]]);
    expect(r.resumenDias).toMatchObject({ consumido: 6, saldoUtilizable: 30 });
  });
});

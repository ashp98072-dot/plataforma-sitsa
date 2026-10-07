import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const m = await import("./vacaciones-registro-bd.testutil");
  return {
    query: (sql: string, p?: unknown[]) => m.bd.consulta(sql, p),
    execute: async () => { throw new Error("no usar execute del pool"); },
    getPool: () => ({ getConnection: async () => m.bd.conexion() }),
  };
});

import { bd, EMPRESA, escenario } from "./vacaciones-registro-bd.testutil";
import { obtenerHistorialPeriodos, registrarVacacionesFifo } from "./vacaciones";
import { previsualizarRegistro, registrarVacaciones, type EntradaRegistro } from "./vacaciones-registro";
import { eliminarRegistroVacaciones } from "./vacaciones-eliminar";
import { contarDiasHabilesPuro } from "./vacaciones-reconstruccion";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 7, 12)); // 2026-10-07
  bd.reiniciar(escenario()); // Ana: fecha_alta 2019-10-14 (ejemplo del ticket)
});
afterEach(() => vi.useRealTimers());

const reg = (inicio: string, fin: string, dias: number, extra: Partial<EntradaRegistro> = {}) =>
  registrarVacaciones({ empresaId: EMPRESA, idEmpleado: 1, fechaInicio: inicio, fechaFin: fin, diasATomar: dias, tipo: "Vacaciones", usuario: "rrhh.ana", ...extra });
const MOTIVO = "Aprobado por la gerencia de RRHH tras revisar la boleta.";
const saldoDe = (anio: number) => bd.t.saldos.find((s) => s.id_empleado === 1 && s.anio_laboral === anio)!;
const detalleDe = (incidenciaId: number) => bd.t.detalle.filter((d) => d.incidencia_id === incidenciaId).map((d) => [bd.t.saldos.find((s) => s.id === d.saldo_id)!.anio_laboral, d.dias_tomados]);
const vigentes = () => Math.round(bd.t.saldos.filter((s) => s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0) * 100) / 100;
/** Períodos 2, 3 y 4 ya consumidos por completo (histórico real): fuerza que un cruce de aniversario llegue al año 5 (hoy Vigente). */
function agotarAnios234() {
  for (const [anio, id] of [[2, 901], [3, 902], [4, 903]] as const) {
    bd.t.incidencias.push({ id, empresa_id: EMPRESA, id_empleado: 1, tipo: "Vacaciones", fecha_inicio: `2021-0${anio}-01`, fecha_fin: `2021-0${anio}-02`, dias_habiles: 15 });
    bd.t.detalle.push({ id, incidencia_id: id, saldo_id: saldoDe(anio).id, dias_tomados: 15 });
  }
}

describe("serie base (la lógica actual NO cambia)", () => {
  it("18/17) 15 días por año completo, proporcional del período en curso, vencimiento y tope de 30 sobre el saldo UTILIZABLE", async () => {
    const h = await obtenerHistorialPeriodos(EMPRESA, 1);
    expect(h.periodos).toHaveLength(7);
    expect(h.periodos.filter((p) => p.anioLaboral !== 7).every((p) => p.diasOtorgados === 15)).toBe(true);
    expect(h.periodos[6]).toMatchObject({ anioLaboral: 7, diasOtorgados: 14.76, estadoVisual: "En curso" });
    expect(h.periodos.map((p) => p.estado)).toEqual(["Vencido", "Vencido", "Vencido", "Vencido", "Vigente", "Vigente", "Vigente"]);
    expect(h.saldoActual).toBe(30);
    expect(h.periodos.slice(0, 4).every((p) => p.diasDisponibles === 0)).toBe(true);
  });
});

describe("registro NORMAL: sin regresión", () => {
  it("1) vacación del período actual: camino de siempre (FIFO sobre los Vigentes de hoy), sin marca histórica ni auditoría nueva", async () => {
    const r = await reg("2026-09-14", "2026-09-18", 5);
    expect(r.ok).toBe(true);
    expect(r.historico).toBeUndefined();
    expect(detalleDe(r.incidenciaId!)).toEqual([[5, 0.24], [6, 4.76]]);
    expect(vigentes()).toBe(25);
    expect(bd.t.auditoria).toEqual([]);
  });

  it("22) idéntico al flujo anterior: mismo estado final que `registrarVacacionesFifo` con los mismos datos", async () => {
    await registrarVacacionesFifo({ empresaId: EMPRESA, idEmpleado: 1, fechaInicio: "2026-09-14", fechaFin: "2026-09-18", diasATomar: 5, tipo: "Vacaciones" });
    const legado = bd.instantanea();
    bd.reiniciar(escenario());
    await reg("2026-09-14", "2026-09-18", 5);
    expect(bd.instantanea()).toEqual(legado);
  });

  it("2) vacación de hace 1 año (su período sigue Vigente hoy): registro normal, NO histórico", async () => {
    const r = await reg("2025-09-15", "2025-09-19", 5);
    expect(r.ok).toBe(true);
    expect(r.historico).toBeUndefined();
  });

  it("fechas futuras: lógica normal (el motor histórico nunca consume saldo futuro inexistente)", async () => {
    const r = await reg("2027-03-01", "2027-03-05", 5);
    expect(r.historico).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(detalleDe(r.incidenciaId!).every(([anio]) => anio !== 8)).toBe(true);
  });
});

describe("registro HISTÓRICO", () => {
  it("3/5) hace 3 años en un período HOY Vencido: se registra contra el saldo que tenía en esa fecha (no «ya venció»)", async () => {
    const r = await reg("2023-05-08", "2023-05-12", 5);
    expect(r).toMatchObject({ ok: true, historico: true });
    expect(r.plan!.periodoInicio).toMatchObject({ anioLaboral: 4, estadoHoy: "Vencido" });
    expect(detalleDe(r.incidenciaId!)).toEqual([[2, 5]]); // FIFO histórico: el más antiguo utilizable ese día
    expect(bd.t.incidencias.find((i) => i.id === r.incidenciaId)).toMatchObject({ tipo: "Vacaciones", fecha_inicio: "2023-05-08", fecha_fin: "2023-05-12", dias_habiles: 5 });
    expect(bd.t.vacaciones.some((v) => v.fecha_inicio === "2023-05-08" && v.dias_habiles === 5)).toBe(true); // fila espejo
    expect(bd.t.auditoria.map((a) => a.accion)).toEqual(["vacaciones_registro_historico"]);
    expect(bd.eventos.filter((e) => e === "COMMIT")).toHaveLength(1);
  });

  it("4) hace 5+ años (2020, año laboral 1 en curso entonces)", async () => {
    const r = await reg("2020-06-01", "2020-06-05", 5);
    expect(r).toMatchObject({ ok: true, historico: true });
    expect(detalleDe(r.incidenciaId!)).toEqual([[1, 5]]);
    expect(r.plan!.tramos[0].disponiblePorPeriodo).toEqual([expect.objectContaining({ anioLaboral: 1, libre: 9.51 })]);
  });

  it("6) FIFO histórico: primero el período más antiguo utilizable ese día y luego el siguiente (2022-05-10: años 1 y 2)", async () => {
    const r = await reg("2022-05-10", "2022-05-20", 9);
    // el tope de 30 de esa fecha recortó al más antiguo: 15 − 8.58 (acumulado del año en curso) = 6.42
    expect(detalleDe(r.incidenciaId!)).toEqual([[1, 6.42], [2, 2.58]]);
  });

  it("7) nunca consume un período futuro: en 2020-02 solo existía el año 1; lo que falta es déficit, no saldo inventado", async () => {
    const p = await previsualizarRegistro(EMPRESA, 1, "2020-02-03", "2020-02-07", 5);
    expect(p.plan!.tramos[0].disponiblePorPeriodo.map((d) => d.anioLaboral)).toEqual([1]);
    expect(p.plan!.tramos[0].asignaciones.map((a) => a.anioLaboral)).toEqual([1]);
    expect(p.plan!.deficit).toBe(0.37);
  });

  it("8) no altera el saldo actual: ni infla, ni reactiva períodos Vencidos, ni supera el tope", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    const antes = bd.instantanea().saldos.map((s) => [s.anio_laboral, s.estado, s.dias_disponibles]);
    await reg("2023-05-08", "2023-05-12", 5);
    await reg("2022-05-10", "2022-05-20", 9);
    const despues = bd.instantanea().saldos.map((s) => [s.anio_laboral, s.estado, s.dias_disponibles]);
    expect(despues).toEqual(antes);
    expect(vigentes()).toBeLessThanOrEqual(30);
  });

  it("8b) si el consumo histórico alcanza un período que HOY sigue Vigente, el saldo de hoy baja exactamente lo consumido (nunca sube)", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    agotarAnios234();
    const antes = saldoDe(5).dias_disponibles; // 0.24
    const sin = await reg("2023-10-13", "2023-10-16", 3);
    expect(sin).toMatchObject({ ok: false, codigo: "DECISION_REQUERIDA" });
    const r = await reg("2023-10-13", "2023-10-16", 3, { decision: { huella: sin.plan!.huella, motivo: MOTIVO } });
    expect(r.ok).toBe(true);
    expect(detalleDe(r.incidenciaId!)).toEqual([[5, 0.05]]);
    expect(saldoDe(5).dias_disponibles).toBe(Math.round((antes - 0.05) * 100) / 100); // 0.24 → 0.19
    expect(saldoDe(5).estado).toBe("Vigente");
    expect([1, 2, 3, 4].every((a) => saldoDe(a).estado === "Vencido")).toBe(true);
    expect(vigentes()).toBeLessThanOrEqual(30);
  });

  it("9) anterior a la fecha de alta: bloqueado, sin escribir nada", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    const antes = bd.instantanea();
    const r = await reg("2019-09-02", "2019-09-06", 5);
    expect(r).toMatchObject({ ok: false, codigo: "ANTERIOR_A_FECHA_ALTA" });
    expect(bd.instantanea()).toEqual(antes);
  });

  it("10) superpuesta con otra vacación del mismo empleado: ERROR, no se guarda; una contigua sí", async () => {
    await reg("2023-05-08", "2023-05-12", 5);
    const antes = bd.instantanea();
    const r = await reg("2023-05-10", "2023-05-16", 5);
    expect(r).toMatchObject({ ok: false, codigo: "SUPERPOSICION" });
    expect(r.mensaje).toContain("2023-05-08");
    expect(bd.instantanea()).toEqual(antes);
    expect((await reg("2023-05-13", "2023-05-20", 6)).ok).toBe(true);
  });

  it("11) saldo insuficiente histórico: no inventa saldo, muestra el déficit y exige una decisión explícita (no se guarda por defecto)", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    const antes = bd.instantanea();
    const r = await reg("2020-02-03", "2020-02-07", 5);
    expect(r).toMatchObject({ ok: false, codigo: "DECISION_REQUERIDA", requiereDecision: true });
    expect(r.plan).toMatchObject({ deficit: 0.37 });
    expect(r.plan!.decisiones.map((d) => d.codigo)).toEqual(["SALDO_INSUFICIENTE_HISTORICO"]);
    expect(bd.instantanea()).toEqual(antes);
    // decisión sin motivo suficiente o con otra huella: sigue sin guardar
    expect((await reg("2020-02-03", "2020-02-07", 5, { decision: { huella: r.plan!.huella, motivo: "ok" } })).codigo).toBe("DECISION_REQUERIDA");
    expect((await reg("2020-02-03", "2020-02-07", 5, { decision: { huella: "0".repeat(64), motivo: MOTIVO } })).codigo).toBe("DECISION_REQUERIDA");
    expect(bd.instantanea()).toEqual(antes);
    // con la decisión explícita ligada a la propuesta: se guarda con el déficit visible y auditado
    const ok = await reg("2020-02-03", "2020-02-07", 5, { decision: { huella: r.plan!.huella, motivo: MOTIVO } });
    expect(ok).toMatchObject({ ok: true, historico: true });
    expect(detalleDe(ok.incidenciaId!)).toEqual([[1, 4.63]]);
    expect(bd.t.incidencias.find((i) => i.id === ok.incidenciaId)!.dias_habiles).toBe(5);
    expect(JSON.parse(bd.t.auditoria.at(-1)!.detalle!)).toMatchObject({ deficit: 0.37, decision: { motivo: MOTIVO }, decisiones: ["SALDO_INSUFICIENTE_HISTORICO"] });
  });

  it("12) cruza un aniversario: se divide en tramos con la lógica existente y queda como DECISION visible (solo ese caso la requiere)", async () => {
    const simple = await reg("2023-05-08", "2023-05-12", 5);
    expect(simple.ok).toBe(true); // el registro histórico general NO exige decisión
    const r = await reg("2023-10-05", "2023-10-20", 15);
    expect(r).toMatchObject({ ok: false, codigo: "DECISION_REQUERIDA" });
    expect(r.plan!.cruzaAniversario).toBe(true);
    expect(r.plan!.aniversarios).toEqual(["2023-10-14"]);
    expect(r.plan!.tramos.map((t) => [t.desde, t.hasta, t.dias])).toEqual([["2023-10-05", "2023-10-13", 8], ["2023-10-14", "2023-10-20", 7]]);
    const ok = await reg("2023-10-05", "2023-10-20", 15, { decision: { huella: r.plan!.huella, motivo: MOTIVO } });
    expect(ok.ok).toBe(true);
    expect(Math.round(detalleDe(ok.incidenciaId!).reduce((s, [, d]) => s + Number(d), 0) * 100) / 100).toBe(15);
    expect(bd.t.auditoria.at(-1)!.detalle).toContain("VACACION_CRUZA_ANIVERSARIO");
  });

  it("19) domingos y feriados siguen igual: el tramo previo al aniversario descuenta el feriado y excluye domingos", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    const sinFeriado = await previsualizarRegistro(EMPRESA, 1, "2023-10-05", "2023-10-20", 15);
    bd.feriados = ["2023-10-12"];
    const conFeriado = await previsualizarRegistro(EMPRESA, 1, "2023-10-05", "2023-10-20", 15);
    expect(sinFeriado.plan!.tramos[0].dias).toBe(8); // el domingo 8 no cuenta
    expect(conFeriado.plan!.tramos[0].dias).toBe(7);
    expect(contarDiasHabilesPuro("2023-10-05", "2023-10-13", new Set())).toBe(8);
    expect(contarDiasHabilesPuro("2023-10-05", "2023-10-13", new Set(["2023-10-12"]))).toBe(7);
  });

  it("21) fecha_alta sospechosa: bloqueado (no se inventan 127 períodos)", async () => {
    bd.reiniciar(escenario({ fechaAlta: "1899-12-31" }));
    const antes = bd.instantanea();
    const r = await reg("2010-05-03", "2010-05-07", 5);
    expect(r).toMatchObject({ ok: false, codigo: "FECHA_ALTA_SOSPECHOSA" });
    expect(bd.instantanea()).toEqual(antes);
  });

  it("20) multiempresa: nunca toca ni considera datos de otra empresa", async () => {
    bd.t.empleados.push({ id: 2, empresa_id: 8, nombre: "Otra Empresa", fecha_alta: "2019-10-14" });
    bd.t.incidencias.push({ id: 700, empresa_id: 8, id_empleado: 2, tipo: "Vacaciones", fecha_inicio: "2023-05-08", fecha_fin: "2023-05-12", dias_habiles: 5 });
    bd.t.vacaciones.push({ id: 700, empresa_id: 8, id_empleado: 2, fecha_inicio: "2023-05-08", fecha_fin: "2023-05-12", dias_habiles: 5, estado: "Aprobado" });
    // una vacación del MISMO rango en otra empresa no es superposición
    expect((await reg("2023-05-08", "2023-05-12", 5)).ok).toBe(true);
    // pedir un empleado de otra empresa con la empresa 7 no encuentra nada ni escribe en la empresa 8
    const empresa8 = bd.instantanea().incidencias.filter((i) => i.empresa_id === 8);
    const r = await registrarVacaciones({ empresaId: EMPRESA, idEmpleado: 2, fechaInicio: "2023-05-08", fechaFin: "2023-05-12", diasATomar: 5, tipo: "Vacaciones" });
    expect(r.ok).toBe(false);
    expect(bd.t.saldos.filter((s) => s.empresa_id === 8)).toEqual([]);
    expect(bd.instantanea().incidencias.filter((i) => i.empresa_id === 8)).toEqual(empresa8);
  });

  it("todo-o-nada: un fallo a mitad del registro histórico revierte TODO", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    const antes = bd.instantanea();
    bd.fallarSi = (sql) => sql.startsWith("INSERT INTO detalle_consumo_vacaciones");
    const r = await reg("2023-05-08", "2023-05-12", 5);
    expect(r.ok).toBe(false);
    expect(bd.instantanea()).toEqual(antes);
    expect(bd.eventos).toContain("ROLLBACK");
  });

  it("la vista previa es de SOLO LECTURA: ni sincroniza ni escribe", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    const p = await previsualizarRegistro(EMPRESA, 1, "2023-05-08", "2023-05-12", 5);
    expect(p).toMatchObject({ aplica: true, esHistorico: true, puedeGuardar: true });
    expect(p.plan!.tramos[0].disponiblePorPeriodo.map((d) => [d.anioLaboral, d.libre])).toEqual([[2, 6.52], [3, 15], [4, 8.48]]);
    expect(bd.ejecutadas.every((s) => s.startsWith("SELECT"))).toBe(true);
    expect(bd.instantanea()).toEqual(antes);
  });
});

describe("edición y eliminación de un registro histórico", () => {
  it("14/15) eliminar: borra detalle, espejo e incidencia; el período Vencido NO se reactiva ni recupera días y el Vigente recupera EXACTAMENTE lo consumido", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    const a = await reg("2023-05-08", "2023-05-12", 5); // consume el año 2 (Vencido hoy)
    const antesVigentes = vigentes();
    const del = await eliminarRegistroVacaciones(EMPRESA, a.incidenciaId!, "rrhh.ana");
    expect(del).toMatchObject({ ok: true, diasRestaurados: 0, diasNoRestaurados: 5 });
    expect(bd.t.detalle.filter((d) => d.incidencia_id === a.incidenciaId)).toEqual([]);
    expect(bd.t.vacaciones.some((v) => v.fecha_inicio === "2023-05-08")).toBe(false);
    expect(bd.t.incidencias.some((i) => i.id === a.incidenciaId)).toBe(false);
    expect(saldoDe(2)).toMatchObject({ estado: "Vencido", dias_disponibles: 0 }); // no se reactiva
    expect(vigentes()).toBe(antesVigentes); // no sube el saldo de hoy

    // un registro NORMAL (años 5 y 6, Vigentes): al eliminarlo vuelve exactamente a los mismos períodos
    const n = await reg("2026-09-14", "2026-09-18", 5);
    const tras = vigentes();
    const del2 = await eliminarRegistroVacaciones(EMPRESA, n.incidenciaId!, "rrhh.ana");
    expect(del2).toMatchObject({ ok: true, diasRestaurados: 5 });
    expect(saldoDe(5).dias_disponibles).toBe(0.24);
    expect(saldoDe(6).dias_disponibles).toBe(15);
    expect(vigentes()).toBe(Math.round((tras + 5) * 100) / 100);
  });

  it("15b) un histórico con tramo en un período hoy Vigente: al eliminar se restaura al MISMO período (0.19 → 0.24) y no al que no correspondía", async () => {
    await obtenerHistorialPeriodos(EMPRESA, 1);
    agotarAnios234();
    const p = await reg("2023-10-13", "2023-10-16", 3);
    const r = await reg("2023-10-13", "2023-10-16", 3, { decision: { huella: p.plan!.huella, motivo: MOTIVO } });
    expect(saldoDe(5).dias_disponibles).toBe(0.19);
    const del = await eliminarRegistroVacaciones(EMPRESA, r.incidenciaId!, "rrhh.ana");
    expect(del).toMatchObject({ ok: true, diasRestaurados: 0.05 });
    expect(saldoDe(5).dias_disponibles).toBe(0.24);
    expect(saldoDe(4).dias_disponibles).toBe(0); // el año 4 (Vencido) no recibe días
  });

  it("13) editar un histórico = eliminarlo y registrarlo de nuevo: el resultado es el mismo FIFO (los días liberados vuelven a estar disponibles en esa fecha)", async () => {
    const a = await reg("2023-05-08", "2023-05-12", 5);
    const antes = detalleDe(a.incidenciaId!);
    await eliminarRegistroVacaciones(EMPRESA, a.incidenciaId!, "rrhh.ana");
    const b = await reg("2023-05-08", "2023-05-12", 5);
    expect(b.ok).toBe(true);
    expect(detalleDe(b.incidenciaId!)).toEqual(antes);
    // corregir las fechas: el consumo anterior ya no ocupa el período
    await eliminarRegistroVacaciones(EMPRESA, b.incidenciaId!, "rrhh.ana");
    const c = await reg("2023-06-05", "2023-06-09", 5);
    expect(c.ok).toBe(true);
    expect(detalleDe(c.incidenciaId!)).toEqual([[2, 5]]);
  });
});

describe("historial de períodos", () => {
  it("16) muestra TODOS los períodos antiguos con sus consumos relacionados; el saldo utilizable sigue siendo el de hoy (tope 30)", async () => {
    await reg("2023-05-08", "2023-05-12", 5);
    await reg("2022-05-10", "2022-05-20", 9);
    const h = await obtenerHistorialPeriodos(EMPRESA, 1);
    expect(h.periodos.map((p) => p.anioLaboral)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    // lo ya consumido contra un período reduce lo que el tope de 30 de esa fecha recorta: el orden de registro es el del detalle real
    const p2 = h.periodos.find((p) => p.anioLaboral === 2)!;
    expect(p2).toMatchObject({ estado: "Vencido", diasConsumidos: 5 });
    expect(p2.consumos.map((c) => [c.fechaInicio, c.dias])).toEqual([["2023-05-08", 5]]);
    const p1 = h.periodos.find((p) => p.anioLaboral === 1)!;
    expect(p1).toMatchObject({ estado: "Vencido", diasConsumidos: 9 });
    expect(p1.consumos).toEqual([expect.objectContaining({ fechaInicio: "2022-05-10", fechaFin: "2022-05-20", dias: 9, tipo: "Vacaciones" })]);
    expect(h.saldoActual).toBe(30);
  });
});

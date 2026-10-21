import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const m = await import("./vacaciones-registro-bd.testutil");
  return {
    query: (sql: string, p?: unknown[]) => m.bd.consulta(sql, p),
    execute: async () => { throw new Error("no usar execute del pool"); },
    getPool: () => ({ getConnection: async () => m.bd.conexion() }),
  };
});

import { bd, EMPRESA, type Tablas } from "./vacaciones-registro-bd.testutil";
import { RebaseBloqueadoError, previsualizarRebase, rebasearVacacionesEnConexion } from "./vacaciones-rebase-db";
import { MENSAJE_ANTERIOR_A_ALTA, planificarRebase, type HechoVacacion, type SaldoPrevio } from "./vacaciones-rebase";
import { obtenerHistorialPeriodos } from "./vacaciones";
import { previsualizarRegistro, registrarVacaciones } from "./vacaciones-registro";
import { eliminarRegistroVacaciones } from "./vacaciones-eliminar";

const EMP = 1;
const sumaDetalle = (t: Tablas) => Math.round(t.detalle.reduce((s, d) => s + d.dias_tomados, 0) * 100) / 100;
const vigentes = () => Math.round(bd.t.saldos.filter((s) => s.id_empleado === EMP && s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0) * 100) / 100;
const hoyFijo = (iso: string) => { vi.useFakeTimers(); vi.setSystemTime(new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), 12)); };

/** Simula la transacción de `actualizarEmpleado`: rebase y, si todo va bien, COMMIT (en la app el UPDATE de la ficha va después, en la misma transacción). */
async function cambiarFechaAlta(nueva: string) {
  const conn = bd.conexion();
  await conn.beginTransaction();
  try {
    const r = await rebasearVacacionesEnConexion(conn as never, EMPRESA, EMP, nueva, { usuario: "rrhh.ana" });
    bd.t.empleados.find((e) => e.id === EMP)!.fecha_alta = nueva; // el UPDATE de la ficha (misma transacción)
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Datos del caso principal: alta 2025-01-01, Año 1 consumido por completo (15 días), hoy 2026-01-15. */
function casoPrincipal(extra: Partial<Tablas> = {}) {
  bd.reiniciar({
    empleados: [{ id: EMP, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: "2025-01-01" }],
    saldos: [
      { id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 0, estado: "Vigente" },
      { id: 2, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 2, periodo_inicio: "2026-01-01", periodo_fin: "2026-12-31", dias_otorgados: 0.62, dias_disponibles: 0.62, estado: "Vigente" },
    ],
    incidencias: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Vacaciones", fecha_inicio: "2025-11-03", fecha_fin: "2025-11-21", dias_habiles: 15 }],
    vacaciones: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, fecha_inicio: "2025-11-03", fecha_fin: "2025-11-21", dias_habiles: 15, estado: "Aprobado" }],
    detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 15 }],
    ...extra,
  });
}
const periodos = () => bd.t.saldos.filter((s) => s.id_empleado === EMP).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));

afterEach(() => vi.useRealTimers());

describe("rebase al cambiar fecha_alta: caso principal del ticket (2025 → 2024)", () => {
  beforeEach(() => { hoyFijo("2026-01-15"); casoPrincipal(); });

  it("3/4/5) mover hacia atrás con vacaciones consumidas: 30 otorgados históricos, 15 consumidos, saldo 15 — NO 30 disponibles + 15 consumidos", async () => {
    const r = await cambiarFechaAlta("2024-01-01");
    expect(r.aplicado).toBe(true);
    const ps = periodos();
    expect(ps.map((p) => [p.anio_laboral, p.periodo_inicio, p.periodo_fin])).toEqual([[1, "2024-01-01", "2024-12-31"], [2, "2025-01-01", "2025-12-31"], [3, "2026-01-01", "2026-12-31"]]);
    expect(ps[0]).toMatchObject({ dias_otorgados: 15, dias_disponibles: 0, estado: "Vigente" }); // el año 1 queda consumido
    expect(ps[1]).toMatchObject({ dias_otorgados: 15, dias_disponibles: 15 });
    expect(ps[0].dias_otorgados + ps[1].dias_otorgados).toBe(30);
    expect(sumaDetalle(bd.t)).toBe(15); // consumidos históricos intactos
    expect(vigentes()).toBe(Math.round((15 + ps[2].dias_disponibles) * 100) / 100); // 15 restantes (+ el proporcional del período en curso)
    expect(vigentes()).toBeLessThan(16); // jamás 30 + 15
  });

  it("9/10) las vacaciones siguen existiendo con los mismos IDs y el detalle FIFO se reasigna al período correcto de la nueva serie", async () => {
    const antes = bd.instantanea();
    await cambiarFechaAlta("2024-01-01");
    expect(bd.t.incidencias).toEqual(antes.incidencias);
    expect(bd.t.vacaciones).toEqual(antes.vacaciones);
    expect(bd.t.detalle).toHaveLength(1);
    const d = bd.t.detalle[0];
    expect(d).toMatchObject({ incidencia_id: 10, dias_tomados: 15 });
    expect(bd.t.saldos.find((s) => s.id === d.saldo_id)).toMatchObject({ anio_laboral: 1, periodo_inicio: "2024-01-01" }); // FIFO: el más antiguo utilizable en esa fecha
    expect([1, 2].includes(d.saldo_id)).toBe(false); // los saldos viejos ya no existen
  });

  it("1) la fecha_alta no cambia: cero diferencias y ninguna escritura", async () => {
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    const r = await cambiarFechaAlta("2025-01-01");
    expect(r.aplicado).toBe(false);
    expect(bd.instantanea()).toEqual(antes);
    expect(bd.ejecutadas.some((s) => /^(INSERT|DELETE|UPDATE)/.test(s))).toBe(false);
  });

  it("auditoría: empleado, fechas, períodos anteriores y nuevos, consumo preservado, saldo antes/después, usuario", async () => {
    await cambiarFechaAlta("2024-01-01");
    const a = bd.t.auditoria.at(-1)!;
    expect(a).toMatchObject({ empresa_id: EMPRESA, usuario: "rrhh.ana", accion: "vacaciones_rebase_fecha_alta" });
    expect(JSON.parse(a.detalle!)).toMatchObject({ empleadoId: EMP, fechaAnterior: "2025-01-01", fechaNueva: "2024-01-01", periodosAnteriores: 2, periodosNuevos: 3, vacacionesConservadas: 1, consumidoPreservado: 15, saldoAntes: 0.62 });
    expect(JSON.parse(a.detalle!).saldoDespues).toBeGreaterThan(15);
    expect(JSON.parse(a.detalle!).fecha).toMatch(/^2026-01-15/);
  });

  it("la vista previa informa períodos actuales/resultantes, consumo preservado y saldo antes/después, sin escribir nada", async () => {
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    const p = (await previsualizarRebase(EMPRESA, EMP, "2024-01-01", new Date(2026, 0, 15)))!;
    expect(p).toMatchObject({ aplica: true, fechaAnterior: "2025-01-01", fechaNueva: "2024-01-01", periodosAntes: 2, vacaciones: 1, consumidoPreservado: 15, saldoAntes: 0.62, bloqueos: [] });
    expect(p.periodos.map((x) => x.anioLaboral)).toEqual([1, 2, 3]);
    expect(p.saldoDespues).toBeGreaterThan(15);
    expect(bd.ejecutadas.every((s) => s.startsWith("SELECT"))).toBe(true);
    expect(bd.instantanea()).toEqual(antes);
  });

  it("14) las evidencias de las incidencias quedan intactas (no se tocan las incidencias)", async () => {
    bd.t.evidencias.push({ id: 5, empresa_id: EMPRESA, incidencia_id: 10, ruta_archivo: "empresas/7/evidencias/inc10-boleta.pdf" });
    const antes = bd.instantanea().evidencias;
    await cambiarFechaAlta("2024-01-01");
    expect(bd.t.evidencias).toEqual(antes);
  });

  it("16) incidencias de otros tipos intactas", async () => {
    bd.t.incidencias.push({ id: 90, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Permiso con goce", fecha_inicio: "2025-03-03", fecha_fin: "2025-03-04", dias_habiles: 2 });
    await cambiarFechaAlta("2024-01-01");
    expect(bd.t.incidencias.find((i) => i.id === 90)).toMatchObject({ tipo: "Permiso con goce", dias_habiles: 2 });
    expect(bd.t.incidencias).toHaveLength(2);
  });

  it("15) multiempresa: otras empresas y otros empleados no cambian", async () => {
    bd.t.empleados.push({ id: 2, empresa_id: 8, nombre: "Otra", fecha_alta: "2025-01-01" }, { id: 3, empresa_id: EMPRESA, nombre: "Otro empleado", fecha_alta: "2025-01-01" });
    bd.t.saldos.push({ id: 50, empresa_id: 8, id_empleado: 2, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 3, estado: "Vigente" });
    bd.t.saldos.push({ id: 51, empresa_id: EMPRESA, id_empleado: 3, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 7, estado: "Vigente" });
    await cambiarFechaAlta("2024-01-01");
    expect(bd.t.saldos.find((s) => s.id === 50)).toMatchObject({ empresa_id: 8, dias_disponibles: 3 });
    expect(bd.t.saldos.find((s) => s.id === 51)).toMatchObject({ id_empleado: 3, dias_disponibles: 7 });
  });
});

describe("rebase: otros casos", () => {
  beforeEach(() => hoyFijo("2026-01-15"));

  it("2) mover hacia atrás SIN vacaciones: se regenera una serie única y coherente", async () => {
    casoPrincipal({ incidencias: [], vacaciones: [], detalle: [] });
    bd.t.saldos[0].dias_disponibles = 15;
    await cambiarFechaAlta("2024-01-01");
    expect(periodos().map((p) => p.anio_laboral)).toEqual([1, 2, 3]);
    // 15 + 15 + 0.62 del período en curso: el tope de 30 (regla vigente) recorta el excedente del período completo más viejo
    expect(periodos()[0]).toMatchObject({ periodo_inicio: "2024-01-01", dias_disponibles: 14.38 });
    expect(vigentes()).toBe(30);
    expect(bd.t.detalle).toEqual([]);
  });

  it("6/7) una serie vieja TRASLAPADA y duplicada queda reemplazada por UNA sola serie coherente, sin saldo duplicado (patrón de corrección de fecha_alta)", async () => {
    // serie vieja desde otra base, más una serie ya generada desde la nueva base (años laborales repetidos y traslapes), con consumos en ambas
    casoPrincipal();
    bd.t.saldos.push(
      { id: 3, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 1, periodo_inicio: "2024-01-01", periodo_fin: "2024-12-31", dias_otorgados: 15, dias_disponibles: 15, estado: "Vencido" },
      { id: 4, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 2, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" },
    );
    expect(bd.t.saldos.length).toBe(4); // coexisten períodos viejos y nuevos
    bd.t.detalle.push({ id: 2, incidencia_id: 10, saldo_id: 4, dias_tomados: 0 }); // línea espuria sobre la serie duplicada
    await cambiarFechaAlta("2024-01-01");
    const ps = periodos();
    expect(ps.map((p) => p.anio_laboral)).toEqual([1, 2, 3]); // sin años duplicados
    expect(new Set(ps.map((p) => p.periodo_inicio)).size).toBe(3);
    for (let i = 1; i < ps.length; i++) expect(ps[i].periodo_inicio > ps[i - 1].periodo_fin).toBe(true); // sin traslapes
    expect(sumaDetalle(bd.t)).toBe(15);
    expect(vigentes()).toBeLessThan(16);
  });

  it("8) el saldo utilizable actual sigue ≤ 30 aunque haya muchos períodos", async () => {
    hoyFijo("2026-10-07");
    bd.reiniciar({
      empleados: [{ id: EMP, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: "2016-03-15" }],
      saldos: [{ id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 1, periodo_inicio: "2016-03-15", periodo_fin: "2017-03-14", dias_otorgados: 15, dias_disponibles: 0, estado: "Vencido" }],
    });
    await cambiarFechaAlta("2015-03-15");
    expect(periodos()).toHaveLength(12);
    expect(vigentes()).toBeLessThanOrEqual(30);
    expect(periodos().filter((p) => p.estado === "Vigente")).toHaveLength(3);
    expect(periodos().filter((p) => p.anio_laboral !== 12).every((p) => p.dias_otorgados === 15)).toBe(true);
  });

  it("12) mover la fecha hacia ADELANTE es válido si ninguna vacación queda antes: el consumo se reubica en la nueva serie", async () => {
    bd.reiniciar({
      empleados: [{ id: EMP, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: "2023-01-01" }],
      saldos: [{ id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 2, periodo_inicio: "2024-01-01", periodo_fin: "2024-12-31", dias_otorgados: 15, dias_disponibles: 10, estado: "Vigente" }],
      incidencias: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Vacaciones", fecha_inicio: "2025-05-05", fecha_fin: "2025-05-09", dias_habiles: 5 }],
      vacaciones: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, fecha_inicio: "2025-05-05", fecha_fin: "2025-05-09", dias_habiles: 5, estado: "Aprobado" }],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 5 }],
    });
    await cambiarFechaAlta("2024-01-01");
    expect(periodos().map((p) => p.periodo_inicio)).toEqual(["2024-01-01", "2025-01-01", "2026-01-01"]);
    expect(sumaDetalle(bd.t)).toBe(5);
    expect(bd.t.saldos.find((s) => s.id === bd.t.detalle[0].saldo_id)!.anio_laboral).toBe(1); // 2024 completo: FIFO
  });

  it("11) una vacación ANTERIOR a la nueva fecha_alta bloquea el cambio, sin escribir nada y con el mensaje claro", async () => {
    bd.reiniciar({
      empleados: [{ id: EMP, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: "2023-01-01" }],
      saldos: [{ id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 3, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 10, estado: "Vigente" }],
      incidencias: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Vacaciones", fecha_inicio: "2025-03-03", fecha_fin: "2025-03-07", dias_habiles: 5 }],
      vacaciones: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, fecha_inicio: "2025-03-03", fecha_fin: "2025-03-07", dias_habiles: 5, estado: "Aprobado" }],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 5 }],
    });
    const antes = bd.instantanea();
    const err = await cambiarFechaAlta("2025-06-01").catch((e) => e);
    expect(err).toBeInstanceOf(RebaseBloqueadoError);
    expect((err as Error).message).toContain(MENSAJE_ANTERIOR_A_ALTA);
    expect((err as RebaseBloqueadoError).plan.bloqueos[0].codigo).toBe("VACACION_ANTERIOR_A_NUEVA_ALTA");
    expect(bd.instantanea()).toEqual(antes); // ni saldos, ni detalle, ni fecha_alta
    expect(bd.eventos).toContain("ROLLBACK");
  });

  it("si con la nueva base una vacación queda sin saldo suficiente en su fecha, tampoco se cambia nada (no se inventa saldo)", async () => {
    bd.reiniciar({
      empleados: [{ id: EMP, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: "2023-01-01" }],
      saldos: [{ id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 3, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 5, estado: "Vigente" }],
      incidencias: [{ id: 10, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Vacaciones", fecha_inicio: "2025-02-03", fecha_fin: "2025-02-14", dias_habiles: 10 }],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 10 }],
    });
    const antes = bd.instantanea();
    const err = await cambiarFechaAlta("2025-01-01").catch((e) => e);
    expect(err).toBeInstanceOf(RebaseBloqueadoError);
    expect((err as RebaseBloqueadoError).plan.bloqueos[0].codigo).toBe("DEFICIT_AL_REBASAR");
    expect(bd.instantanea()).toEqual(antes);
  });

  it("fecha nueva futura, inválida o sospechosa con vacaciones registradas ⇒ bloqueo; sin vacaciones no hay nada que proteger", () => {
    const hecho: HechoVacacion = { incidenciaId: 1, tipo: "Vacaciones", inicio: "2025-05-05", fin: "2025-05-09", dias: 5, consumido: 5 };
    const saldo: SaldoPrevio = { id: 1, anioLaboral: 1, inicio: "2025-01-01", fin: "2025-12-31", otorgados: 15, disponibles: 10, estado: "Vigente" };
    const base = { fechaAnterior: "2025-01-01", hoy: new Date(2026, 0, 15), hechos: [hecho], saldos: [saldo], feriados: new Set<string>() };
    expect(planificarRebase({ ...base, fechaNueva: "2027-01-01" }).bloqueos[0].codigo).toBe("FECHA_NUEVA_FUTURA");
    expect(planificarRebase({ ...base, fechaNueva: "1899-12-31" }).bloqueos[0].codigo).toBe("FECHA_NUEVA_SOSPECHOSA");
    expect(planificarRebase({ ...base, fechaNueva: "2025/01/01" }).bloqueos[0].codigo).toBe("FECHA_NUEVA_INVALIDA");
    // SIN vacaciones pero CON saldos: existe una serie que depende de fecha_alta ⇒ también bloquea (antes devolvía aplica=false y dejaba los saldos con la base anterior)
    const sinVacaciones = planificarRebase({ ...base, hechos: [], fechaNueva: "1899-12-31" });
    expect(sinVacaciones.aplica).toBe(true);
    expect(sinVacaciones.bloqueos[0].codigo).toBe("FECHA_NUEVA_SOSPECHOSA");
    expect(sinVacaciones.bloqueos[0].mensaje).toContain("períodos de vacaciones ya generados");
    const futuraSinVacaciones = planificarRebase({ ...base, hechos: [], fechaNueva: "2027-01-01" });
    expect(futuraSinVacaciones.aplica).toBe(true);
    expect(futuraSinVacaciones.bloqueos[0].codigo).toBe("FECHA_NUEVA_FUTURA");
    expect(planificarRebase({ ...base, hechos: [], saldos: [], fechaNueva: "2024-01-01" }).aplica).toBe(false);
  });
});

describe("rebase: todo-o-nada y no regresión", () => {
  beforeEach(() => { hoyFijo("2026-01-15"); casoPrincipal(); });

  it("13) un fallo intermedio (insertar el detalle FIFO, los saldos o borrar la serie vieja) revierte TODO y la fecha_alta no cambia", async () => {
    for (const fallo of ["INSERT INTO detalle_consumo_vacaciones", "INSERT INTO saldos_vacaciones", "DELETE FROM saldos_vacaciones", "INSERT INTO auditoria"]) {
      casoPrincipal();
      const antes = bd.instantanea();
      bd.fallarSi = (sql) => sql.startsWith(fallo);
      await expect(cambiarFechaAlta("2024-01-01")).rejects.toThrow();
      expect(bd.instantanea()).toEqual(antes);
      expect(bd.t.empleados[0].fecha_alta).toBe("2025-01-01");
      expect(bd.eventos).toContain("ROLLBACK");
    }
  });

  it("17/18) después del rebase el registro histórico (#421) sigue funcionando y respeta la fecha real de cada consumo", async () => {
    await cambiarFechaAlta("2024-01-01");
    const libreN1 = async (inicio: string, fin: string) => (await previsualizarRegistro(EMPRESA, EMP, inicio, fin, 3)).plan!.tramos[0].disponiblePorPeriodo.find((d) => d.anioLaboral === 1)!.libre;
    // la vacación de noviembre 2025 (15 días del año 1) es POSTERIOR a junio 2025: no reduce su saldo; sí reduce el de diciembre
    expect(await libreN1("2025-06-02", "2025-06-04")).toBe(15);
    expect(await libreN1("2025-12-01", "2025-12-03")).toBe(0);
    const r = await registrarVacaciones({ empresaId: EMPRESA, idEmpleado: EMP, fechaInicio: "2024-03-04", fechaFin: "2024-03-06", diasATomar: 3, tipo: "Vacaciones", usuario: "rrhh.ana" });
    expect(r.ok).toBe(true); // el año 1 (2024) hoy sigue Vigente: registro normal; y no se superpone con nada
    expect(await obtenerHistorialPeriodos(EMPRESA, EMP).then((h) => h.periodos.map((p) => p.anioLaboral))).toEqual([1, 2, 3]);
  });

  it("eliminar una vacación después del rebase devuelve el consumo al período de la NUEVA serie", async () => {
    await cambiarFechaAlta("2024-01-01");
    const del = await eliminarRegistroVacaciones(EMPRESA, 10, "rrhh.ana");
    expect(del).toMatchObject({ ok: true, diasRestaurados: 15, diasAjustadosPorTope: 0.62 });
    // se devuelve al año 1 de la serie NUEVA; el tope de 30 vuelve a recortar el excedente del período en curso (regla existente)
    expect(bd.t.saldos.find((s) => s.id_empleado === EMP && s.anio_laboral === 1)!.dias_disponibles).toBe(14.38);
    expect(vigentes()).toBe(30);
  });

  it("después del rebase la sincronización normal no congela ni duplica nada (serie coherente con la fecha de alta)", async () => {
    await cambiarFechaAlta("2024-01-01");
    const antes = bd.instantanea().saldos;
    const h = await obtenerHistorialPeriodos(EMPRESA, EMP);
    expect(h.requiereReparacion).toBe(false);
    expect(h.advertencias.filter((a) => a.bloqueante)).toEqual([]);
    expect(bd.instantanea().saldos).toEqual(antes);
  });
});

describe("DETALLE FIFO CRUZADO hacia saldos de otro empleado / otra empresa = hard blocker (preview y rebase real)", () => {
  const A = { id: EMP, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: "2025-01-01" };
  const incidenciaA = { id: 10, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Vacaciones", fecha_inicio: "2025-05-05", fecha_fin: "2025-05-09", dias_habiles: 5 };
  const espejoA = { id: 10, empresa_id: EMPRESA, id_empleado: EMP, fecha_inicio: "2025-05-05", fecha_fin: "2025-05-09", dias_habiles: 5, estado: "Aprobado" };
  const saldoA = { id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 10, estado: "Vigente" };
  const sinEscrituras = () => bd.ejecutadas.every((s) => !/^(INSERT|UPDATE|DELETE)/.test(s));

  beforeEach(() => hoyFijo("2026-01-15"));

  async function debeBloquear(codigo: string) {
    const antes = bd.instantanea();
    bd.ejecutadas = [];
    const p = (await previsualizarRebase(EMPRESA, EMP, "2024-01-01", new Date(2026, 0, 15)))!;
    expect(p.aplica).toBe(true);
    expect(p.bloqueos.map((b) => b.codigo)).toContain(codigo);
    expect(sinEscrituras()).toBe(true); // la vista previa no escribe nada
    expect(bd.instantanea()).toEqual(antes);
    const err = await cambiarFechaAlta("2024-01-01").catch((e) => e);
    expect(err).toBeInstanceOf(RebaseBloqueadoError);
    expect((err as RebaseBloqueadoError).plan.bloqueos.map((b) => b.codigo)).toContain(codigo);
    expect(sinEscrituras()).toBe(true); // ni un INSERT / UPDATE / DELETE: no se borra, ni reasigna, ni corrige la línea
    expect(bd.instantanea()).toEqual(antes); // ninguna fila cambió
    expect(bd.t.empleados.find((e) => e.id === EMP)!.fecha_alta).toBe("2025-01-01"); // fecha_alta de A intacta
    expect(bd.eventos).toContain("ROLLBACK");
    return err as RebaseBloqueadoError;
  }

  it("1) MISMA EMPRESA / OTRO EMPLEADO: la incidencia #10 de A consume el saldo #50 de B ⇒ preview y rebase bloqueados, cero escrituras", async () => {
    bd.reiniciar({
      empleados: [A, { id: 2, empresa_id: EMPRESA, nombre: "Beto Ruiz", fecha_alta: "2025-01-01" }],
      saldos: [saldoA, { id: 50, empresa_id: EMPRESA, id_empleado: 2, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 4, estado: "Vigente" }],
      incidencias: [incidenciaA], vacaciones: [espejoA],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 50, dias_tomados: 5 }],
    });
    const err = await debeBloquear("DETALLE_SALDO_AJENO");
    expect(err.message).toContain("consumo de una vacación del colaborador asociado a un saldo que no le pertenece");
    expect(err.message).toContain("revisión administrada");
    expect(err.message).toContain("saldo #50");
    expect(err.message).toContain("otro empleado");
    expect(bd.t.saldos.find((s) => s.id === 50)).toMatchObject({ id_empleado: 2, dias_disponibles: 4 }); // saldo de B intacto
    expect(bd.t.detalle).toEqual([{ id: 1, incidencia_id: 10, saldo_id: 50, dias_tomados: 5 }]); // detalle intacto
  });

  it("2) OTRA EMPRESA: la incidencia #10 de la empresa 7 consume el saldo #60 de la empresa 8 ⇒ bloqueo, cero escrituras, datos de la empresa 8 intactos", async () => {
    bd.reiniciar({
      empleados: [A, { id: 3, empresa_id: 8, nombre: "Otra Empresa", fecha_alta: "2025-01-01" }],
      saldos: [saldoA, { id: 60, empresa_id: 8, id_empleado: 3, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 9, estado: "Vigente" }],
      incidencias: [incidenciaA], vacaciones: [espejoA],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 60, dias_tomados: 5 }],
    });
    const err = await debeBloquear("DETALLE_SALDO_AJENO");
    expect(err.message).toContain("otra empresa");
    expect(bd.t.saldos.find((s) => s.id === 60)).toMatchObject({ empresa_id: 8, id_empleado: 3, dias_disponibles: 9 });
    expect(bd.t.empleados.find((e) => e.id === 3)!.fecha_alta).toBe("2025-01-01");
  });

  it("también bloquea si UNA sola línea de varias es ajena (la propia sana no basta)", async () => {
    bd.reiniciar({
      empleados: [A, { id: 2, empresa_id: EMPRESA, nombre: "Beto Ruiz", fecha_alta: "2025-01-01" }],
      saldos: [saldoA, { id: 50, empresa_id: EMPRESA, id_empleado: 2, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 12, estado: "Vigente" }],
      incidencias: [incidenciaA], vacaciones: [espejoA],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 3 }, { id: 2, incidencia_id: 10, saldo_id: 50, dias_tomados: 2 }],
    });
    await debeBloquear("DETALLE_SALDO_AJENO");
  });

  it("3) el caso contrario sigue bloqueado: detalle sobre un saldo del empleado proveniente de una incidencia AJENA (DETALLE_AJENO)", async () => {
    bd.reiniciar({
      empleados: [A, { id: 2, empresa_id: EMPRESA, nombre: "Beto Ruiz", fecha_alta: "2025-01-01" }],
      saldos: [saldoA],
      incidencias: [incidenciaA, { id: 90, empresa_id: EMPRESA, id_empleado: 2, tipo: "Vacaciones", fecha_inicio: "2025-07-07", fecha_fin: "2025-07-08", dias_habiles: 2 }],
      vacaciones: [espejoA],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 5 }, { id: 2, incidencia_id: 90, saldo_id: 1, dias_tomados: 2 }],
    });
    await debeBloquear("DETALLE_AJENO");
  });

  it("4) caso sano: todas las líneas son del mismo empleado y empresa ⇒ no hay bloqueo de detalle y el rebase continúa funcionando igual", async () => {
    bd.reiniciar({
      empleados: [A, { id: 2, empresa_id: EMPRESA, nombre: "Beto Ruiz", fecha_alta: "2025-01-01" }],
      saldos: [saldoA, { id: 50, empresa_id: EMPRESA, id_empleado: 2, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 4, estado: "Vigente" }],
      incidencias: [incidenciaA], vacaciones: [espejoA],
      detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 5 }],
    });
    const p = (await previsualizarRebase(EMPRESA, EMP, "2024-01-01", new Date(2026, 0, 15)))!;
    expect(p.bloqueos).toEqual([]);
    const r = await cambiarFechaAlta("2024-01-01");
    expect(r.aplicado).toBe(true);
    expect(sumaDetalle(bd.t)).toBe(5);
    expect(bd.t.saldos.find((s) => s.id === 50)).toMatchObject({ id_empleado: 2, dias_disponibles: 4 }); // el saldo de otro empleado ni se toca
    expect(bd.t.detalle.every((d) => bd.t.saldos.find((s) => s.id === d.saldo_id)!.id_empleado === EMP)).toBe(true);
  });

  it("un saldo inexistente (detalle huérfano) también bloquea: no se puede verificar a quién pertenece", async () => {
    bd.reiniciar({ empleados: [A], saldos: [saldoA], incidencias: [incidenciaA], vacaciones: [espejoA], detalle: [{ id: 1, incidencia_id: 10, saldo_id: 999, dias_tomados: 5 }] });
    const err = await debeBloquear("DETALLE_SALDO_AJENO");
    expect(err.message).toContain("inexistente");
  });

  it("si la fecha no cambia no se evalúa nada ni se bloquea (comportamiento actual idéntico)", async () => {
    bd.reiniciar({ empleados: [A], saldos: [saldoA], incidencias: [incidenciaA], vacaciones: [espejoA], detalle: [{ id: 1, incidencia_id: 10, saldo_id: 999, dias_tomados: 5 }] });
    const r = await cambiarFechaAlta("2025-01-01");
    expect(r.aplicado).toBe(false);
  });
});

describe("SIN vacaciones tomadas pero CON saldos: la serie depende de fecha_alta y nunca puede quedar con la base anterior", () => {
  const empleado = { id: EMP, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: "2025-01-01" };
  /** Serie existente calculada desde 2025-01-01, consumo 0, sin incidencias ni detalle. */
  const seriesSinConsumo = () => bd.reiniciar({
    empleados: [empleado],
    saldos: [
      { id: 1, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 1, periodo_inicio: "2025-01-01", periodo_fin: "2025-12-31", dias_otorgados: 15, dias_disponibles: 15, estado: "Vigente" },
      { id: 2, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: 2, periodo_inicio: "2026-01-01", periodo_fin: "2026-12-31", dias_otorgados: 0.62, dias_disponibles: 0.62, estado: "Vigente" },
    ],
  });
  beforeEach(() => hoyFijo("2026-01-15"));

  it("1/5) fecha válida distinta: el rebase aplica y TODOS los períodos resultan derivados de la nueva fecha (ninguno de la anterior)", async () => {
    seriesSinConsumo();
    const p = (await previsualizarRebase(EMPRESA, EMP, "2024-01-01", new Date(2026, 0, 15)))!;
    expect(p).toMatchObject({ aplica: true, bloqueos: [], vacaciones: 0, consumidoPreservado: 0, periodosAntes: 2 });
    const r = await cambiarFechaAlta("2024-01-01");
    expect(r.aplicado).toBe(true);
    const ps = periodos();
    expect(ps.map((x) => [x.anio_laboral, x.periodo_inicio, x.periodo_fin])).toEqual([[1, "2024-01-01", "2024-12-31"], [2, "2025-01-01", "2025-12-31"], [3, "2026-01-01", "2026-12-31"]]);
    expect(ps.some((x) => x.periodo_inicio === "2025-01-01" && x.anio_laboral === 1)).toBe(false); // no queda el período de la fecha anterior
    expect(new Set(ps.map((x) => x.id)).size).toBe(3);
    expect(bd.t.detalle).toEqual([]); // sin consumo
    expect(bd.t.saldos.every((s) => s.id !== 1 && s.id !== 2)).toBe(true); // las filas viejas fueron reemplazadas
    expect(JSON.parse(bd.t.auditoria.at(-1)!.detalle!)).toMatchObject({ fechaAnterior: "2025-01-01", fechaNueva: "2024-01-01", vacacionesConservadas: 0, consumidoPreservado: 0, periodosAnteriores: 2, periodosNuevos: 3 });
    // el tope de 30 de la regla vigente: 15 + 15 + 0.62 ⇒ recorta 0.62 del período completo más viejo
    expect(vigentes()).toBe(30);
  });

  for (const [titulo, nueva] of [["2) fecha FUTURA", "2027-01-01"], ["3) fecha SOSPECHOSA (< 1980)", "1899-12-31"], ["fecha INVÁLIDA", "2025/01/01"]] as const) {
    it(`${titulo}: la vista previa y el guardado bloquean; fecha_alta y saldos no cambian y no hay escrituras persistentes`, async () => {
      seriesSinConsumo();
      const antes = bd.instantanea();
      bd.ejecutadas = [];
      const p = (await previsualizarRebase(EMPRESA, EMP, nueva, new Date(2026, 0, 15)))!;
      expect(p.aplica).toBe(true);
      expect(p.bloqueos).toHaveLength(1);
      expect(bd.ejecutadas.every((s) => s.startsWith("SELECT"))).toBe(true);
      const err = await cambiarFechaAlta(nueva).catch((e) => e);
      expect(err).toBeInstanceOf(RebaseBloqueadoError);
      expect(bd.ejecutadas.some((s) => /^(INSERT|UPDATE|DELETE)/.test(s))).toBe(false);
      expect(bd.instantanea()).toEqual(antes);
      expect(bd.t.empleados[0].fecha_alta).toBe("2025-01-01");
      expect(bd.eventos).toContain("ROLLBACK");
    });
  }

  it("4) SIN vacaciones Y SIN saldos: no hay serie que rebasar ⇒ no-op del rebase (el cambio de fecha sigue su camino normal)", async () => {
    bd.reiniciar({ empleados: [empleado] });
    bd.ejecutadas = [];
    for (const nueva of ["2024-01-01", "1899-12-31", "2027-01-01"]) {
      const p = (await previsualizarRebase(EMPRESA, EMP, nueva, new Date(2026, 0, 15)))!;
      expect(p.aplica).toBe(false);
      expect(p.bloqueos).toEqual([]);
    }
    const r = await cambiarFechaAlta("1899-12-31");
    expect(r.aplicado).toBe(false);
    expect(bd.t.saldos).toEqual([]);
    expect(bd.ejecutadas.some((s) => /^(INSERT|DELETE)/.test(s))).toBe(false);
  });

  it("con saldos y consumo 0, los bloqueos de detalle ajeno se siguen respetando (el saldo del empleado consumido por la incidencia de OTRO empleado)", async () => {
    seriesSinConsumo();
    bd.t.incidencias.push({ id: 90, empresa_id: EMPRESA, id_empleado: 2, tipo: "Vacaciones", fecha_inicio: "2025-07-07", fecha_fin: "2025-07-08", dias_habiles: 2 });
    bd.t.detalle.push({ id: 1, incidencia_id: 90, saldo_id: 1, dias_tomados: 2 });
    const antes = bd.instantanea();
    const err = await cambiarFechaAlta("2024-01-01").catch((e) => e);
    expect(err).toBeInstanceOf(RebaseBloqueadoError);
    expect((err as RebaseBloqueadoError).plan.bloqueos.map((b) => b.codigo)).toContain("DETALLE_AJENO");
    expect(bd.instantanea()).toEqual(antes);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const m = await import("./vacaciones-registro-bd.testutil");
  return {
    query: (sql: string, p?: unknown[]) => m.bd.consulta(sql, p),
    execute: async () => { throw new Error("no usar execute del pool"); },
    getPool: () => ({ getConnection: async () => m.bd.conexion() }),
  };
});

import { bd, EMPRESA, type Saldo, type Tablas } from "./vacaciones-registro-bd.testutil";
import { previsualizarReparacion, repararSerieVacaciones } from "./vacaciones-reparacion-db";
import { calcularDiasAcumuladosProporcional, periodoLaboral, aIso, deIso } from "./vacaciones-periodos";
import { obtenerHistorialPeriodos } from "./vacaciones";
import { registrarVacaciones } from "./vacaciones-registro";
import { eliminarRegistroVacaciones } from "./vacaciones-eliminar";

/**
 * COBERTURA EXPLÍCITA de la regla: la reparación reconstruye SIEMPRE todo el historial desde `empleados.fecha_alta` (años 1..N, también los ya
 * vencidos), con períodos por aniversario calendario (los domingos no los desplazan), 15 días por año completo y la acumulación proporcional
 * EXISTENTE (`calcularDiasAcumuladosProporcional`, que excluye domingos) para el año en curso. No introduce ninguna regla ni motor nuevo.
 * Datos 100 % sintéticos. "Hoy" = 2026-10-08.
 */
const EMP = 1;
const ALTA = "2023-04-13";
const HOY = new Date(2026, 9, 8);
const hoyFijo = () => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 8, 12)); };
const r2 = (n: number) => Math.round(n * 100) / 100;

const sal = (id: number, anio: number, ini: string, fin: string, otorg: number, disp: number): Saldo =>
  ({ id, empresa_id: EMPRESA, id_empleado: EMP, anio_laboral: anio, periodo_inicio: ini, periodo_fin: fin, dias_otorgados: otorg, dias_disponibles: disp, estado: "Vigente" });
/** Serie dañada del ticket (bases distintas y traslapes) sobre la fecha de alta 2023-04-13. */
const serieDanada = (): Saldo[] => [
  sal(1, 1, "2023-06-01", "2024-05-31", 15, 15), sal(2, 2, "2024-05-31", "2025-05-30", 15, 15),
  sal(3, 3, "2025-04-13", "2026-04-12", 15, 15), sal(4, 4, "2026-04-13", "2027-04-12", 7.5, 7.5),
];
const inc = (id: number, ini: string, fin: string, dias: number) => ({ id, empresa_id: EMPRESA, id_empleado: EMP, tipo: "Vacaciones", fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias });
const vac = (id: number, ini: string, fin: string, dias: number) => ({ id, empresa_id: EMPRESA, id_empleado: EMP, fecha_inicio: ini, fecha_fin: fin, dias_habiles: dias, estado: "Aprobado" });
const empleado = (fecha_alta = ALTA) => ({ id: EMP, empresa_id: EMPRESA, nombre: "Colaborador Sintético", fecha_alta });

const periodos = () => bd.t.saldos.filter((s) => s.id_empleado === EMP).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0));
const fechas = () => periodos().map((s) => [s.anio_laboral, s.periodo_inicio, s.periodo_fin]);
async function reparar() {
  const p = (await previsualizarReparacion(EMPRESA, EMP))!;
  return repararSerieVacaciones(EMPRESA, EMP, { huella: p.huella, usuario: "rrhh.ana" });
}
const porIncidencia = (t: Tablas) => { const m = new Map<number, number>(); for (const d of t.detalle) m.set(d.incidencia_id, r2((m.get(d.incidencia_id) ?? 0) + d.dias_tomados)); return [...m].sort((a, b) => a[0] - b[0]); };
const total = (t: Tablas) => r2(t.detalle.reduce((s, d) => s + d.dias_tomados, 0));

/** Cálculo INDEPENDIENTE (días calendario − domingos) para verificar que la fórmula existente sigue excluyendo domingos. */
function laborables(ini: Date, fin: Date): number {
  let n = 0;
  for (const d = new Date(ini); d <= fin; d.setDate(d.getDate() + 1)) if (d.getDay() !== 0) n++;
  return n;
}
const calendario = (ini: Date, fin: Date) => Math.round((fin.getTime() - ini.getTime()) / 86400000) + 1;

beforeEach(hoyFijo);
afterEach(() => vi.useRealTimers());

describe("fecha_alta 13/04/2023 y hoy 08/10/2026: la reparación propone TODO el historial, años 1 a 4", () => {
  beforeEach(() => bd.reiniciar({ empleados: [empleado()], saldos: serieDanada() }));

  it("1-5) la vista previa propone exactamente los años 1,2,3,4 con sus fechas por aniversario", async () => {
    const p = (await previsualizarReparacion(EMPRESA, EMP))!;
    expect(p.requiereReparacion).toBe(true);
    expect(p.periodosPropuestos.map((x) => x.anioLaboral)).toEqual([1, 2, 3, 4]);
    expect(p.periodosPropuestos.map((x) => [x.inicio, x.fin])).toEqual([
      ["2023-04-13", "2024-04-12"], ["2024-04-13", "2025-04-12"], ["2025-04-13", "2026-04-12"], ["2026-04-13", "2027-04-12"],
    ]);
    // la fecha de alta no cambia y sigue siendo la base de todos
    expect(p.fechaAltaActual).toBe(ALTA);
  });

  it("6) los años completos usan 15 días según el motor existente; el año 1 sigue en el historial (vencido) con su saldo calculado por las reglas actuales", async () => {
    const p = (await previsualizarReparacion(EMPRESA, EMP))!;
    const [a1, a2, a3] = p.periodosPropuestos;
    expect([a1.otorgados, a2.otorgados, a3.otorgados]).toEqual([15, 15, 15]);
    expect(a1).toMatchObject({ estado: "Vencido", disponibles: 0 }); // pierde su saldo por el vencimiento existente, pero NO desaparece
  });

  it("7) el año en curso usa calcularDiasAcumuladosProporcional (la fórmula existente, sin duplicarla)", async () => {
    const p = (await previsualizarReparacion(EMPRESA, EMP))!;
    const esperado = calcularDiasAcumuladosProporcional(deIso("2026-04-13"), deIso("2027-04-12"), HOY, 15);
    expect(p.periodosPropuestos[3].otorgados).toBe(esperado);
    expect(esperado).toBeGreaterThan(0);
    expect(esperado).toBeLessThan(15);
  });

  it("8) la acumulación proporcional sigue EXCLUYENDO domingos igual que antes (verificado con un cálculo independiente)", async () => {
    const ini = deIso("2026-04-13"); const fin = deIso("2027-04-12");
    const hastaHoy = laborables(ini, HOY);
    const delPeriodo = laborables(ini, fin);
    const sinDomingos = r2((15 * hastaHoy) / delPeriodo);
    const conDomingos = r2((15 * calendario(ini, HOY)) / calendario(ini, fin));
    expect(sinDomingos).not.toBe(conDomingos); // el caso sí distingue la regla
    const p = (await previsualizarReparacion(EMPRESA, EMP))!;
    expect(p.periodosPropuestos[3].otorgados).toBe(sinDomingos);
    expect(calcularDiasAcumuladosProporcional(ini, fin, HOY, 15)).toBe(sinDomingos);
    expect(p.periodosPropuestos[3].otorgados).not.toBe(conDomingos);
  });

  it("10) tras reparar, los períodos vencidos históricos siguen en la BD y en el historial; 11) el saldo utilizable es <= 30", async () => {
    await reparar();
    expect(fechas()).toEqual([[1, "2023-04-13", "2024-04-12"], [2, "2024-04-13", "2025-04-12"], [3, "2025-04-13", "2026-04-12"], [4, "2026-04-13", "2027-04-12"]]);
    expect(periodos()[0]).toMatchObject({ estado: "Vencido", dias_otorgados: 15, dias_disponibles: 0 });
    const h = await obtenerHistorialPeriodos(EMPRESA, EMP);
    expect(h.periodos.map((x) => [x.anioLaboral, x.estadoVisual])).toEqual([[1, "Vencido"], [2, "Vigente"], [3, "Vigente"], [4, "En curso"]]);
    expect(h.saldoActual).toBeLessThanOrEqual(30);
    expect(r2(periodos().filter((s) => s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0))).toBeLessThanOrEqual(30);
  });
});

describe("9) los domingos NO desplazan el inicio ni el fin de los períodos (aniversario calendario)", () => {
  it("fecha de alta en DOMINGO (2023-04-16): cada período empieza el aniversario exacto", async () => {
    bd.reiniciar({ empleados: [empleado("2023-04-16")], saldos: [sal(1, 1, "2023-06-01", "2024-05-31", 15, 15)] });
    await reparar();
    expect(fechas()).toEqual([[1, "2023-04-16", "2024-04-15"], [2, "2024-04-16", "2025-04-15"], [3, "2025-04-16", "2026-04-15"], [4, "2026-04-16", "2027-04-15"]]);
  });
  it("períodos que TERMINAN en domingo (alta 2023-04-14 ⇒ el año 2 termina el domingo 2025-04-13): fin = inicio del siguiente − 1 día, sin desplazar", async () => {
    bd.reiniciar({ empleados: [empleado("2023-04-14")], saldos: [sal(1, 1, "2023-06-01", "2024-05-31", 15, 15)] });
    expect(deIso("2025-04-13").getDay()).toBe(0);
    await reparar();
    expect(fechas()).toEqual([[1, "2023-04-14", "2024-04-13"], [2, "2024-04-14", "2025-04-13"], [3, "2025-04-14", "2026-04-13"], [4, "2026-04-14", "2027-04-13"]]);
    for (const n of [1, 2, 3, 4]) { const p = periodoLaboral(deIso("2023-04-14"), n); expect(periodos()[n - 1]).toMatchObject({ periodo_inicio: aIso(p.inicio), periodo_fin: aIso(p.fin) }); }
  });
});

describe("Con consumo: FIFO, totales y comportamiento posterior intactos sobre la serie histórica completa", () => {
  /** Tres vacaciones: octubre 2023 y agosto 2024 (años 1-2 de la serie nueva, hoy vencido el 1) y agosto 2026 (año 2/3 vigentes). */
  const conConsumo = () => bd.reiniciar({
    empleados: [empleado()], saldos: serieDanada(),
    incidencias: [inc(10, "2023-10-02", "2023-10-06", 5), inc(11, "2024-08-05", "2024-08-09", 5), inc(12, "2026-08-03", "2026-08-07", 5)],
    vacaciones: [vac(10, "2023-10-02", "2023-10-06", 5), vac(11, "2024-08-05", "2024-08-09", 5), vac(12, "2026-08-03", "2026-08-07", 5)],
    detalle: [{ id: 1, incidencia_id: 10, saldo_id: 1, dias_tomados: 5 }, { id: 2, incidencia_id: 11, saldo_id: 2, dias_tomados: 5 }, { id: 3, incidencia_id: 12, saldo_id: 3, dias_tomados: 5 }],
    evidencias: [{ id: 1, empresa_id: EMPRESA, incidencia_id: 10, ruta_archivo: "sintetica/evidencia-1.pdf" }],
  });

  it("12-14) FIFO por año laboral en la fecha de cada vacación; consumo total y por incidencia idéntico; incidencias, vacaciones y evidencias intactas", async () => {
    conConsumo();
    const antes = bd.instantanea();
    await reparar();
    const d = bd.t;
    expect(total(d)).toBe(total(antes));
    expect(porIncidencia(d)).toEqual(porIncidencia(antes));
    expect(d.incidencias).toEqual(antes.incidencias);
    expect(d.vacaciones).toEqual(antes.vacaciones);
    expect(d.evidencias).toEqual(antes.evidencias);
    expect(d.empleados[0].fecha_alta).toBe(ALTA);
    const anioDe = (incidenciaId: number) => d.detalle.filter((x) => x.incidencia_id === incidenciaId).map((x) => d.saldos.find((s) => s.id === x.saldo_id)!.anio_laboral);
    expect(anioDe(10)).toEqual([1]); // FIFO: lo más antiguo disponible a esa fecha
    expect(anioDe(11)).toEqual([1]); // el año 1 aún tenía saldo en agosto de 2024 (15 − 5)
    expect(anioDe(12)).toEqual([2]); // en agosto de 2026 el año 1 ya venció: se consume del año 2
    const a1 = periodos()[0];
    expect(a1).toMatchObject({ estado: "Vencido", dias_otorgados: 15, dias_disponibles: 0 });
    expect(d.detalle.filter((x) => x.saldo_id === a1.id).reduce((s, x) => s + x.dias_tomados, 0)).toBe(10); // el consumo histórico vive en el año vencido
  });

  it("15) después de reparar, la sincronización normal no vuelve a congelar ni cambia la estructura", async () => {
    conConsumo();
    await reparar();
    const estructura = () => periodos().map((s) => [s.anio_laboral, s.periodo_inicio, s.periodo_fin]);
    const antes = estructura();
    const h = await obtenerHistorialPeriodos(EMPRESA, EMP);
    expect(h.requiereReparacion).toBe(false);
    expect(h.advertencias.filter((a) => a.bloqueante)).toEqual([]);
    expect(estructura()).toEqual(antes);
  });

  it("16) registrar una vacación nueva después de reparar funciona y respeta FIFO", async () => {
    conConsumo();
    await reparar();
    const r = await registrarVacaciones({ empresaId: EMPRESA, idEmpleado: EMP, fechaInicio: "2026-09-07", fechaFin: "2026-09-09", diasATomar: 3, tipo: "Vacaciones", usuario: "rrhh.ana" });
    expect(r.ok).toBe(true);
    expect(total(bd.t)).toBe(18);
    expect(fechas().map((f) => f[0])).toEqual([1, 2, 3, 4]);
  });

  it("17) eliminar una vacación después de reparar devuelve los días al período correcto de la serie nueva", async () => {
    conConsumo();
    await reparar();
    const destino = bd.t.detalle.find((x) => x.incidencia_id === 12)!;
    const periodo = bd.t.saldos.find((s) => s.id === destino.saldo_id)!;
    expect(periodo.anio_laboral).toBe(2);
    const del = await eliminarRegistroVacaciones(EMPRESA, 12, "rrhh.ana");
    if (!del.ok) throw new Error(del.error);
    expect(del.desglose).toEqual([expect.objectContaining({ saldoId: periodo.id, anioLaboral: 2, diasRestaurados: 5 })]);
    expect(bd.t.detalle.some((x) => x.incidencia_id === 12)).toBe(false);
    expect(total(bd.t)).toBe(10);
    expect(r2(periodos().filter((s) => s.estado === "Vigente").reduce((a, s) => a + s.dias_disponibles, 0))).toBeLessThanOrEqual(30); // el tope existente se mantiene
  });
});

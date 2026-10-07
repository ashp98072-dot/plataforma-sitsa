import { describe, expect, it } from "vitest";
import { clasificarRegistro, planificarConsumoHistorico, type PeriodoBD } from "./vacaciones-historico";
import { avanzarPeriodos, repartirDiasEnTramos, type EstadoPeriodo } from "./vacaciones-reconstruccion";
import { periodoLaboral } from "./vacaciones-periodos";

const HOY = new Date(2026, 9, 7); // 2026-10-07
const BASE = new Date(2019, 9, 14); // 2019-10-14
const d = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;

/** Filas de saldos_vacaciones como las deja el sistema hoy: 4 Vencidos (disponible 0) y 3 Vigentes (tope aplicado). */
function filas(consumos: Record<number, number> = {}): PeriodoBD[] {
  const vigDisp: Record<number, number> = { 5: 0.24, 6: 15, 7: 14.76 };
  return Array.from({ length: 7 }, (_, i) => {
    const n = i + 1;
    const p = periodoLaboral(BASE, n);
    return { id: n, anioLaboral: n, inicio: iso(p.inicio), fin: iso(p.fin), otorgados: n === 7 ? 14.76 : 15, disponibles: vigDisp[n] ?? 0, estado: n >= 5 ? "Vigente" : "Vencido", consumidoDetalle: consumos[n] ?? 0 };
  });
}
const plan = (inicio: string, fin: string, dias: number, extra: Partial<Parameters<typeof planificarConsumoHistorico>[0]> = {}) =>
  planificarConsumoHistorico({ base: BASE, hoy: HOY, inicio, fin, dias, feriados: new Set(), periodos: filas(), ...extra });

describe("clasificarRegistro: ¿es «Registro histórico»?", () => {
  it("período HOY Vencido ⇒ histórico; período Vigente, actual, futuro o anterior a la fecha base ⇒ no", () => {
    expect(clasificarRegistro(BASE, HOY, "2022-05-10", filas())).toMatchObject({ esHistorico: true, anioLaboral: 3, estadoHoy: "Vencido" });
    expect(clasificarRegistro(BASE, HOY, "2023-10-13", filas()).esHistorico).toBe(true); // último día del año 4
    expect(clasificarRegistro(BASE, HOY, "2023-10-14", filas())).toMatchObject({ esHistorico: false, anioLaboral: 5, estadoHoy: "Vigente" });
    expect(clasificarRegistro(BASE, HOY, "2026-09-14", filas()).esHistorico).toBe(false);
    expect(clasificarRegistro(BASE, HOY, "2027-01-04", filas()).esHistorico).toBe(false);
    expect(clasificarRegistro(BASE, HOY, "2019-09-30", filas()).esHistorico).toBe(false);
    expect(clasificarRegistro(BASE, HOY, "2022/05/10", filas()).esHistorico).toBe(false);
  });

  it("sin filas en BD deriva el estado de hoy con la misma regla de vencimiento (solo los 2 completos más recientes son Vigentes)", () => {
    expect(clasificarRegistro(BASE, HOY, "2023-05-08", []).esHistorico).toBe(true);
    expect(clasificarRegistro(BASE, HOY, "2024-05-08", []).esHistorico).toBe(false);
  });
});

describe("planificarConsumoHistorico: disponibilidad EN LA FECHA de la vacación", () => {
  it("el período Vencido hoy era utilizable en esa fecha: se consume ese período (FIFO por año laboral ascendente)", () => {
    const p = plan("2023-05-08", "2023-05-12", 5);
    expect(p.esHistorico).toBe(true);
    expect(p.tramos[0].asignaciones.map((a) => [a.anioLaboral, a.dias, a.estadoHoy])).toEqual([[2, 5, "Vencido"]]);
    expect(p.tramos[0].disponiblePorPeriodo.map((x) => [x.anioLaboral, x.libre])).toEqual([[2, 6.52], [3, 15], [4, 8.48]]);
    expect(p.requiereDecision).toBe(false);
  });

  it("solo son utilizables los 2 períodos completos más recientes de ESA fecha + el en curso (vencimiento histórico)", () => {
    const p = plan("2023-05-08", "2023-05-12", 5);
    expect(p.tramos[0].disponiblePorPeriodo.map((x) => x.anioLaboral)).toEqual([2, 3, 4]); // el año 1 ya había vencido en esa fecha
  });

  it("nunca consume períodos que todavía no existían: lo que falta es déficit", () => {
    const p = plan("2020-02-03", "2020-02-07", 5);
    expect(p.tramos[0].disponiblePorPeriodo.map((x) => x.anioLaboral)).toEqual([1]);
    expect(p.tramos[0].asignaciones.map((a) => a.anioLaboral)).toEqual([1]);
    expect(p.deficit).toBe(0.37);
    expect(p.decisiones.map((x) => x.codigo)).toEqual(["SALDO_INSUFICIENTE_HISTORICO"]);
    expect(p.requiereDecision).toBe(true);
  });

  it("lo ya consumido (detalle FIFO) reduce lo disponible en esa fecha y puede dejarlo en déficit", () => {
    const p = plan("2020-06-01", "2020-06-05", 5, { periodos: filas({ 1: 12 }) });
    expect(p.tramos[0].disponiblePorPeriodo.map((x) => [x.anioLaboral, x.libre])).toEqual([[1, 0]]);
    expect(p.deficit).toBe(5);
  });

  it("un período que HOY sigue Vigente nunca puede dar más de su disponible de hoy", () => {
    const f = filas({ 2: 15, 3: 15, 4: 15 });
    const p = plan("2023-10-13", "2023-10-16", 3, { periodos: f });
    expect(p.tramos.map((t) => t.asignaciones.map((a) => [a.anioLaboral, a.dias]))).toEqual([[], [[5, 0.05]]]);
    f[4].disponibles = 0.02; // hoy solo quedan 0.02
    const q = plan("2023-10-13", "2023-10-16", 3, { periodos: f });
    expect(q.tramos[1].asignaciones.map((a) => [a.anioLaboral, a.dias])).toEqual([[5, 0.02]]);
  });

  it("cruza un aniversario: tramos con fechas reales (misma función de la reconstrucción) y DECISION visible; nunca bloquea lo demás", () => {
    const p = plan("2023-10-05", "2023-10-20", 15);
    expect(p.cruzaAniversario).toBe(true);
    expect(p.aniversarios).toEqual(["2023-10-14"]);
    expect(p.tramos.map((t) => [t.desde, t.hasta, t.dias, t.fechaEvaluacion])).toEqual([["2023-10-05", "2023-10-13", 8, "2023-10-05"], ["2023-10-14", "2023-10-20", 7, "2023-10-14"]]);
    expect(p.decisiones.map((x) => x.codigo)).toEqual(["VACACION_CRUZA_ANIVERSARIO"]);
    expect(p.bloqueos).toEqual([]);
    expect(p.tramos[1].disponiblePorPeriodo.map((x) => x.anioLaboral)).toEqual([3, 4, 5]); // en el 2.º tramo el año 2 ya venció
  });

  it("la misma función de tramos que usa la reconstrucción: domingos y feriados", () => {
    const sin = repartirDiasEnTramos([d("2023-10-14")], d("2023-10-05"), d("2023-10-20"), 15, new Set());
    const con = repartirDiasEnTramos([d("2023-10-14")], d("2023-10-05"), d("2023-10-20"), 15, new Set(["2023-10-12"]));
    expect(sin.tramos.map((t) => [t.habiles, t.asignados])).toEqual([[8, 8], [6, 7]]); // el 2.º tramo tiene 6 hábiles; los 15 informados sobrepasan el calendario y el remanente cae en el último tramo
    expect(con.tramos.map((t) => [t.habiles, t.asignados])).toEqual([[7, 7], [6, 8]]);
    expect(plan("2023-10-05", "2023-10-20", 15, { feriados: new Set(["2023-10-12"]) }).tramos[0].dias).toBe(7);
  });

  it("bloqueos: fecha de alta ausente / sospechosa / futura, anterior a la fecha de alta y datos inválidos", () => {
    expect(plan("2022-05-10", "2022-05-20", 5, { base: null }).bloqueos[0].codigo).toBe("FECHA_ALTA_AUSENTE");
    expect(plan("2010-05-10", "2010-05-20", 5, { base: d("1899-12-31") }).bloqueos[0].codigo).toBe("FECHA_ALTA_SOSPECHOSA");
    expect(plan("2022-05-10", "2022-05-20", 5, { base: d("2027-01-01") }).bloqueos[0].codigo).toBe("FECHA_ALTA_FUTURA");
    expect(plan("2019-09-01", "2019-09-05", 5).bloqueos[0].codigo).toBe("ANTERIOR_A_FECHA_ALTA");
    expect(plan("2022-05-20", "2022-05-10", 5).bloqueos[0].codigo).toBe("DATOS_INVALIDOS");
    expect(plan("2022-05-10", "2022-05-20", 0).bloqueos[0].codigo).toBe("DATOS_INVALIDOS");
  });

  it("períodos faltantes en BD: se informan (se generan al guardar con el motor actual) y no se inventan ids", () => {
    const p = plan("2023-05-08", "2023-05-12", 5, { periodos: filas().filter((x) => x.anioLaboral !== 2) });
    expect(p.faltantes).toEqual([2]);
    expect(p.tramos[0].asignaciones[0]).toMatchObject({ anioLaboral: 2, saldoId: null });
  });

  it("la huella cambia si cambia la propuesta y es estable para la misma", () => {
    const a = plan("2023-10-05", "2023-10-20", 15);
    const b = plan("2023-10-05", "2023-10-20", 15);
    const c = plan("2023-10-05", "2023-10-20", 14);
    expect(a.huella).toMatch(/^[0-9a-f]{64}$/);
    expect(a.huella).toBe(b.huella);
    expect(a.huella).not.toBe(c.huella);
  });

  it("no reactiva períodos ni infla saldo: la planificación no modifica las filas de entrada", () => {
    const f = filas();
    const copia = JSON.parse(JSON.stringify(f));
    plan("2022-05-10", "2022-05-20", 9, { periodos: f });
    expect(f).toEqual(copia);
  });
});

describe("avanzarPeriodos (reutilizado del motor cronológico)", () => {
  it("el gancho antes del tope permite descontar lo consumido y el tope de 30 se aplica sobre lo realmente disponible", () => {
    const mk = (): EstadoPeriodo[] => [1, 2, 3].map((n) => ({ ...periodoLaboral(BASE, n), anioLaboral: n, otorgados: 0, disponibles: 0, consumidos: 0, recortados: 0, perdidos: 0, vencido: false }));
    const sinGancho = mk();
    avanzarPeriodos(sinGancho, d("2022-05-10")); // 2 completos + el en curso acumulado: 15 + 15 + ~8.58 → recorte del más viejo
    const conGancho = mk();
    avanzarPeriodos(conGancho, d("2022-05-10"), (ps) => { ps[0].disponibles = Math.max(0, ps[0].disponibles - 15); });
    expect(sinGancho[0].disponibles).toBeLessThan(15);
    expect(conGancho[0].disponibles).toBe(0);
    expect(conGancho[1].disponibles).toBe(15); // sin exceso que recortar: el tope no toca al siguiente
  });
});

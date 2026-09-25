import { describe, expect, it } from "vitest";
import {
  calcularDevengoPeriodo,
  diasBase30,
  diasBase30EnMes,
  diasDevengadosQuincenas,
  empleadoEntraEnPeriodo,
  importePorDias,
  ordinalComercial,
  quincenasDelMes,
  repartirConceptoMensual,
  resumenDevengoUi,
  type TipoPeriodoDevengo,
} from "./planilla-devengo";

/**
 * RRHH PLANILLAS — devengo proporcional (funciones puras). Sueldo mensual de ejemplo: Q6,000 (Q200/día en base 30).
 * Casos del ticket: salario 1-16, más los meses de 28/29/30/31 días y la inclusión por relación laboral.
 */
const SUELDO = 6000;
const Q1 = { tipoPeriodo: "QUINCENA_1" as TipoPeriodoDevengo, fechaInicio: "2026-09-01", fechaFin: "2026-09-15" };
const Q2 = { tipoPeriodo: "QUINCENA_2" as TipoPeriodoDevengo, fechaInicio: "2026-09-16", fechaFin: "2026-09-30" };
const v = (inicioLaboral: string | null, finLaboral: string | null = null) => ({ inicioLaboral, finLaboral });
const dias = (p: typeof Q1, vig: ReturnType<typeof v>) => calcularDevengoPeriodo(p, vig).diasDevengados;
const sueldoDe = (p: typeof Q1, vig: ReturnType<typeof v>, mes = SUELDO) => {
  const d = diasDevengadosQuincenas(p as never, vig);
  return repartirConceptoMensual({ mensualBase: mes, diasQ1: d.diasQ1, diasQ2: d.diasQ2, quincena: p.tipoPeriodo === "QUINCENA_1" ? 1 : 2 });
};

describe("SALARIO — días devengados y sueldo del período", () => {
  it("1) activo toda la Q1: 15 días / 50% del mensual (Q3,000)", () => {
    expect(dias(Q1, v("2020-01-01"))).toBe(15);
    expect(sueldoDe(Q1, v("2020-01-01"))).toBe(3000);
  });
  it("2) ingreso el día 7 de Q1: 9 días, Q1,800 (ejemplo A del ticket)", () => {
    expect(dias(Q1, v("2026-09-07"))).toBe(9);
    expect(sueldoDe(Q1, v("2026-09-07"))).toBe(1800);
  });
  it("3) ingreso el día 15: 1 día (Q200)", () => {
    expect(dias(Q1, v("2026-09-15"))).toBe(1);
    expect(sueldoDe(Q1, v("2026-09-15"))).toBe(200);
  });
  it("4) ingreso el día 16: no entra en Q1", () => {
    expect(empleadoEntraEnPeriodo({ estado: "Activo", ...v("2026-09-16") }, Q1)).toBe(false);
    expect(empleadoEntraEnPeriodo({ estado: "Activo", ...v("2026-09-16") }, Q2)).toBe(true);
  });
  it("5) ingreso el día 20: proporcional en Q2 (11 días = Q2,200); no usa 'mensual - Q1'", () => {
    expect(dias(Q2, v("2026-09-20"))).toBe(11);
    expect(sueldoDe(Q2, v("2026-09-20"))).toBe(2200);
  });
  it("6) baja el día 3: 3 días, Q600 (ejemplo B del ticket)", () => {
    expect(dias(Q1, v("2020-01-01", "2026-09-03"))).toBe(3);
    expect(sueldoDe(Q1, v("2020-01-01", "2026-09-03"))).toBe(600);
  });
  it("7) baja el día 15: Q1 completa (15 días)", () => {
    expect(dias(Q1, v("2020-01-01", "2026-09-15"))).toBe(15);
    expect(sueldoDe(Q1, v("2020-01-01", "2026-09-15"))).toBe(3000);
    expect(empleadoEntraEnPeriodo({ estado: "Baja", ...v("2020-01-01", "2026-09-15") }, Q2)).toBe(false);
  });
  it("8) baja el día 16: Q1 completa + 1 día en Q2", () => {
    const vig = v("2020-01-01", "2026-09-16");
    expect(dias(Q1, vig)).toBe(15);
    expect(dias(Q2, vig)).toBe(1);
    expect(sueldoDe(Q2, vig)).toBe(200);
    expect(empleadoEntraEnPeriodo({ estado: "Baja", ...vig }, Q2)).toBe(true);
  });
  it("9) alta y baja dentro de la misma quincena (del 5 al 9 = 5 días)", () => {
    const vig = v("2026-09-05", "2026-09-09");
    expect(dias(Q1, vig)).toBe(5);
    expect(sueldoDe(Q1, vig)).toBe(1000);
    expect(empleadoEntraEnPeriodo({ estado: "Baja", ...vig }, Q2)).toBe(false);
  });
  it("10) baja antes del período (31/08): excluido", () => {
    expect(empleadoEntraEnPeriodo({ estado: "Baja", ...v("2020-01-01", "2026-08-31") }, Q1)).toBe(false);
  });
  it("11) ingreso después del período (20/09 en Q1): excluido", () => {
    expect(empleadoEntraEnPeriodo({ estado: "Activo", ...v("2026-09-20") }, Q1)).toBe(false);
  });
  it("12) estado Baja con fecha de egreso DENTRO del período: incluido; Baja sin fecha de egreso no", () => {
    expect(empleadoEntraEnPeriodo({ estado: "Baja", ...v("2020-01-01", "2026-09-03") }, Q1)).toBe(true);
    expect(empleadoEntraEnPeriodo({ estado: "Baja", ...v("2020-01-01", null) }, Q1)).toBe(false);
    expect(empleadoEntraEnPeriodo({ estado: "Suspendido", ...v("2020-01-01") }, Q1)).toBe(false);
  });
  it("relación sin fecha de inicio (dato antiguo): vigente desde antes del período", () => {
    expect(empleadoEntraEnPeriodo({ estado: "Activo", ...v(null) }, Q1)).toBe(true);
    expect(dias(Q1, v(null))).toBe(15);
  });
  it("períodos ESPECIAL / históricos (sin tipo): solo Activos y sin prorrateo (regla anterior intacta)", () => {
    const esp = { tipoPeriodo: "ESPECIAL" as TipoPeriodoDevengo, fechaInicio: "2026-09-01", fechaFin: "2026-09-10" };
    expect(empleadoEntraEnPeriodo({ estado: "Baja", ...v("2020-01-01", "2026-09-03") }, esp)).toBe(false);
    expect(calcularDevengoPeriodo(esp, v("2026-09-07")).prorrateado).toBe(false);
    expect(empleadoEntraEnPeriodo({ estado: "Activo", ...v("2026-09-20") }, { tipoPeriodo: null, fechaInicio: "2026-09-01", fechaFin: "2026-09-15" })).toBe(true);
  });
});

describe("SALARIO — convención base 30 en meses de 28/29/30/31 días", () => {
  const meses: [string, string, string, string, string][] = [
    ["13) mes de 31 días (octubre 2026)", "2026-10-01", "2026-10-15", "2026-10-16", "2026-10-31"],
    ["14) febrero de 28 días (2026)", "2026-02-01", "2026-02-15", "2026-02-16", "2026-02-28"],
    ["15) febrero bisiesto de 29 días (2028)", "2028-02-01", "2028-02-15", "2028-02-16", "2028-02-29"],
    ["mes de 30 días (septiembre 2026)", "2026-09-01", "2026-09-15", "2026-09-16", "2026-09-30"],
  ];
  for (const [nombre, a, b, c, d] of meses) {
    it(`${nombre}: Q1 = 15 días, Q2 = 15 días, mes = 30 días (nunca 31)`, () => {
      const q1 = { tipoPeriodo: "QUINCENA_1" as TipoPeriodoDevengo, fechaInicio: a, fechaFin: b };
      const q2 = { tipoPeriodo: "QUINCENA_2" as TipoPeriodoDevengo, fechaInicio: c, fechaFin: d };
      expect(dias(q1, v("2020-01-01"))).toBe(15);
      expect(dias(q2, v("2020-01-01"))).toBe(15);
      expect(diasBase30EnMes(Number(a.slice(0, 4)), Number(a.slice(5, 7)), v("2020-01-01"))).toBe(30);
      // 16) Q1 + Q2 del empleado del mes completo = sueldo mensual EXACTO (Q2 concilia contra lo persistido de Q1)
      const s1 = sueldoDe(q1, v("2020-01-01"));
      const d2 = diasDevengadosQuincenas(q2 as never, v("2020-01-01"));
      const s2 = repartirConceptoMensual({ mensualBase: SUELDO, diasQ1: d2.diasQ1, diasQ2: d2.diasQ2, quincena: 2, q1Persistido: s1 });
      expect(s1 + s2).toBe(6000);
    });
  }
  it("16) mes completo con centavos: Q1 + Q2 = mensual exacto (sin desfase de redondeo)", () => {
    for (const mensual of [6000.01, 4321.55, 3999.99, 6100.33]) {
      const s1 = repartirConceptoMensual({ mensualBase: mensual, diasQ1: 15, diasQ2: 15, quincena: 1 });
      const s2 = repartirConceptoMensual({ mensualBase: mensual, diasQ1: 15, diasQ2: 15, quincena: 2, q1Persistido: s1 });
      expect(Math.round((s1 + s2) * 100) / 100).toBe(mensual);
    }
  });
  it("febrero: quien trabaja del 16 al 28 cobra 15 días (el mes completo vale 30)", () => {
    const q2 = { tipoPeriodo: "QUINCENA_2" as TipoPeriodoDevengo, fechaInicio: "2026-02-16", fechaFin: "2026-02-28" };
    expect(dias(q2, v("2020-01-01"))).toBe(15);
  });
  it("mes de 31 días: quien ingresa el 31 cobra 1 día; el día 31 no suma un día extra", () => {
    const q2 = { tipoPeriodo: "QUINCENA_2" as TipoPeriodoDevengo, fechaInicio: "2026-10-16", fechaFin: "2026-10-31" };
    expect(dias(q2, v("2026-10-31"))).toBe(1);
    expect(diasBase30("2026-10-16", "2026-10-31")).toBe(15);
  });
  it("ordinal comercial: el último día del mes vale 30 y el 31 no avanza", () => {
    expect(ordinalComercial("2026-02-28")).toBe(ordinalComercial("2026-02-15") + 15);
    expect(ordinalComercial("2026-10-31")).toBe(ordinalComercial("2026-10-30"));
  });
  it("mensual: mes completo = 30 días; ingreso a mitad de mes = proporcional", () => {
    const mes = { tipoPeriodo: "MENSUAL" as TipoPeriodoDevengo, fechaInicio: "2026-10-01", fechaFin: "2026-10-31" };
    expect(calcularDevengoPeriodo(mes, v("2020-01-01")).diasDevengados).toBe(30);
    expect(importePorDias(SUELDO, 30)).toBe(6000);
    expect(calcularDevengoPeriodo(mes, v("2026-10-16")).diasDevengados).toBe(15);
  });
  it("quincenas derivadas de las fechas del período (Q1 → Q2 y Q2 → Q1)", () => {
    expect(quincenasDelMes(Q1 as never).q2).toEqual({ fechaInicio: "2026-09-16", fechaFin: "2026-09-30" });
    expect(quincenasDelMes(Q2 as never).q1).toEqual({ fechaInicio: "2026-09-01", fechaFin: "2026-09-15" });
  });
});

describe("Reparto Q1/Q2 de un concepto mensual", () => {
  it("Q2 sin Q1 para esa persona: solo lo devengado en Q2 (no 'mensual − Q1')", () => {
    expect(repartirConceptoMensual({ mensualBase: 6000, diasQ1: 0, diasQ2: 11, quincena: 2 })).toBe(2200);
  });
  it("ingreso día 7: Q1 1,800 + Q2 3,000 = 4,800 (24 días)", () => {
    const q1 = repartirConceptoMensual({ mensualBase: 6000, diasQ1: 9, diasQ2: 15, quincena: 1 });
    const q2 = repartirConceptoMensual({ mensualBase: 6000, diasQ1: 9, diasQ2: 15, quincena: 2, q1Persistido: q1 });
    expect([q1, q2, q1 + q2]).toEqual([1800, 3000, 4800]);
  });
  it("sin días en el mes: 0", () => {
    expect(repartirConceptoMensual({ mensualBase: 6000, diasQ1: 0, diasQ2: 0, quincena: 1 })).toBe(0);
  });
});

describe("UI — resumen del devengo", () => {
  const periodo = { fechaInicio: "2026-09-01", fechaFin: "2026-09-15" };
  it("días pagados y badges Ingreso / Baja solo si caen en el período", () => {
    const base = { diasPeriodoNominales: 15, prorrateado: true };
    expect(resumenDevengoUi({ ...base, diasDevengados: 9, fechaInicioLaboral: "2026-09-07", fechaEgreso: null }, periodo)).toMatchObject({ dias: "9", ingreso: "Ingreso 07/09/2026", baja: null });
    expect(resumenDevengoUi({ ...base, diasDevengados: 3, fechaInicioLaboral: "2020-01-01", fechaEgreso: "2026-09-03" }, periodo)).toMatchObject({ dias: "3", baja: "Baja 03/09/2026", ingreso: null });
    expect(resumenDevengoUi({ ...base, diasDevengados: 15, fechaInicioLaboral: "2020-01-01", fechaEgreso: null }, periodo)).toMatchObject({ dias: "15", ingreso: null, baja: null });
    expect(resumenDevengoUi(null, periodo).dias).toBe("—"); // línea anterior a este cálculo
  });
});

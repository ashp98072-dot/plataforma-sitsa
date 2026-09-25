import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("./fiscal-antecedentes", () => ({ leerAntecedentesFiscalesTx: vi.fn() }));

import { leerAntecedentesFiscalesTx } from "./fiscal-antecedentes";
import { calcularFiscal2026Empleado, construirInputFiscalEmpleado2026, ErrorFiscalPlanilla2026 } from "./planilla-fiscal-2026";
import { pendientesVacios } from "./planilla-conceptos";
import { calcularMontoHorasExtra, RECARGO_HORA_EXTRA, tarifaHoraOrdinaria } from "./horas-extra";

/**
 * RRHH PLANILLAS — ISR 2026 proyectado con la RELACIÓN LABORAL REAL. El motor (fiscal-isr-2026.ts) es el REAL y sigue
 * siendo el único; el adapter deja de proyectar sueldo × 12 como si el empleado hubiera trabajado todo el año con este
 * patrono: no proyecta meses anteriores al ingreso ni posteriores a un egreso conocido, y prorratea el mes de
 * ingreso/egreso en base 30. Las horas extra ya realizadas entran como ingreso REAL gravable; no se inventan futuras.
 */
const conn = { query: vi.fn() };
type Antecedentes = Awaited<ReturnType<typeof leerAntecedentesFiscalesTx>>;
const confirmado = (over: Record<string, unknown> = {}): Antecedentes => ({
  ultima: null, revisiones: [],
  confirmada: {
    id: 1, revision: 3, creadoPor: "rrhh", creadoEn: "2026-01-01", confirmadoPor: "rrhh", confirmadoEn: "2026-01-02",
    inicioFiscal: "2026-01-01", corteAntecedentes: "2026-01-31",
    ingresosGravadosPrevios: "0.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00",
    datos: { version: 1, declaracionAntecedentes: "SIN_ANTECEDENTES", constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [], otrosPatronos: { declaracion: "NO", agenteRetenedor: "PENDIENTE", remuneraciones: [] } },
    ...over,
  },
});
const periodo = (mes: number, id = 10) => ({ id, mes, fechaInicio: `2026-${String(mes).padStart(2, "0")}-01` });
const empleado = (over: Record<string, unknown> = {}) => ({ id: 7, codigo: "E7", sueldo: 6000, bonoIncentivo: 0, bonoHerramientas: 0, ...over });
const proyectado = (input: Awaited<ReturnType<typeof construirInputFiscalEmpleado2026>>["input"], codigo: string) =>
  input.ingresosPropiosProyectadosRestantes.filter((c) => c.codigoConcepto === codigo).reduce((s, c) => s + Number(c.monto), 0);
const calcular = (p: ReturnType<typeof periodo>, e: ReturnType<typeof empleado>, pend = pendientesVacios()) =>
  calcularFiscal2026Empleado(conn as never, 3, 2026, p, e, pend);

beforeEach(() => {
  vi.resetAllMocks();
  conn.query.mockResolvedValue([[], []]);
  vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(confirmado());
});

describe("ISR proyectado — relación laboral real", () => {
  it("30) ingreso en enero, sueldo fijo, sin extras: proyecta 12 meses completos (sin regresión)", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(1), empleado({ inicioLaboral: "2026-01-01" }), pendientesVacios());
    expect(input.periodosRestantes).toBe(12);
    expect(proyectado(input, "SUELDO_BASE")).toBe(72000);
  });

  it("empleado de años anteriores (con o sin fechas): mismo resultado que antes de este cambio", async () => {
    const a = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), empleado(), pendientesVacios());
    const b = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), empleado({ inicioLaboral: "2019-05-01", finLaboral: null }), pendientesVacios());
    expect(a.input).toEqual(b.input);
    expect(a.input.periodosRestantes).toBe(4);
    expect(proyectado(a.input, "SUELDO_BASE")).toBe(24000); // 6,000 × 4 meses (sep–dic)
  });

  it("31) ingreso el 07/09/2026 sin antecedentes: NO proyecta sueldo × 12 ni un septiembre completo", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), empleado({ inicioLaboral: "2026-09-07" }), pendientesVacios());
    // septiembre: 24 días base 30 = 4,800 + octubre/noviembre/diciembre completos 18,000
    expect(proyectado(input, "SUELDO_BASE")).toBe(22800);
    expect(input.periodosRestantes).toBe(4);
    expect(input.antecedentes).toBeNull();
    expect(input.ingresosPropiosAcumulados).toHaveLength(0); // no hay ingresos previos con este patrono
  });

  it("31b) el motor con ese input da una renta menor que la de un empleado de todo el año restante", async () => {
    const nuevo = await calcular(periodo(9), empleado({ inicioLaboral: "2026-09-07" }));
    const antiguo = await calcular(periodo(9), empleado({ inicioLaboral: "2020-01-01" }));
    expect(Number(nuevo.resultado.rentaBrutaProyectada)).toBeLessThan(Number(antiguo.resultado.rentaBrutaProyectada));
    expect(Number(nuevo.resultado.rentaBrutaProyectada)).toBe(22800);
  });

  it("32) ingreso en septiembre CON antecedentes fiscales de patronos anteriores: se suman una sola vez", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(confirmado({
      datos: { ...confirmado().confirmada!.datos, declaracionAntecedentes: "CON_ANTECEDENTES" },
      ingresosGravadosPrevios: "30000.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "1449.00", isrRetenidoPrevio: "500.00",
    }));
    const { input, resultado } = await calcular(periodo(9), empleado({ inicioLaboral: "2026-09-07" }));
    expect(input.antecedentes).toEqual({ ingresosGravadosQ: "30000.00", ingresosExentosQ: "0.00", igssLaboralQ: "1449.00", isrRetenidoQ: "500.00" });
    expect(Number(resultado.rentaBrutaProyectada)).toBe(52800); // 30,000 previos + 22,800 proyectados
    expect(Number(resultado.isrRetenidoPrevio)).toBe(500);
  });

  it("33) baja conocida antes de diciembre: NO proyecta sueldo después del egreso; los meses restantes son solo los trabajados", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), empleado({ inicioLaboral: "2020-01-01", finLaboral: "2026-10-15" }), pendientesVacios());
    expect(proyectado(input, "SUELDO_BASE")).toBe(9000); // septiembre 6,000 + octubre 15 días 3,000; nada en nov/dic
    expect(input.periodosRestantes).toBe(2);
    expect(Number(input.igssLaboralPropio.proyectadoRestanteQ)).toBeCloseTo(9000 * 0.0483, 2);
  });

  it("33b) baja en el mes actual: solo se proyecta lo devengado hasta el egreso", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), empleado({ finLaboral: "2026-09-03" }), pendientesVacios());
    expect(proyectado(input, "SUELDO_BASE")).toBe(600);
    expect(input.periodosRestantes).toBe(1);
  });

  it("mes de ingreso con Q1 ya autorizada: el resto del mes proyecta solo lo que falta (sin duplicar)", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 1800, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 86.94, isr: 0, conceptos_snapshot: null, mes_periodo: 9, anio_periodo: 2026 },
    ], []]);
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9, 11), empleado({ inicioLaboral: "2026-09-07" }), pendientesVacios());
    expect(proyectado(input, "SUELDO_BASE")).toBe(21000); // (4,800 − 1,800 ya acumulado) + 18,000
    expect(Number(input.ingresosPropiosAcumulados[0].monto)).toBe(1800);
  });

  it("bono incentivo: se proyecta con la misma relación laboral (ingreso 07/09 → 24 días de septiembre)", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), empleado({ inicioLaboral: "2026-09-07", bonoIncentivo: 250 }), pendientesVacios());
    expect(proyectado(input, "BONO_INCENTIVO")).toBe(950); // 200 + 750
  });
});

describe("ISR — horas extra, bonos e ingresos", () => {
  it("34) las horas extra REALES del período aumentan la renta gravable; no se proyectan horas futuras", async () => {
    const sin = await calcular(periodo(9), empleado());
    const conHe = await calcular(periodo(9), empleado(), { ...pendientesVacios(), horasExtra: [{ id: 1, monto: 500, horas: 10, concepto: "Horas extra", fecha: "2026-09-03", notas: "" }] });
    expect(Number(conHe.resultado.rentaBrutaProyectada) - Number(sin.resultado.rentaBrutaProyectada)).toBe(500); // solo lo real, una vez
    expect(proyectado(conHe.input, "HORAS_EXTRA")).toBe(500);
    // octubre–diciembre no llevan horas extra inventadas
    expect(conHe.input.ingresosPropiosProyectadosRestantes.filter((c) => c.codigoConcepto === "HORAS_EXTRA")).toHaveLength(1);
  });

  it("28) sin horas extra registradas no se proyecta ninguna", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), empleado(), pendientesVacios());
    expect(proyectado(input, "HORAS_EXTRA")).toBe(0);
  });

  it("35) un bono gravable (incentivo) aumenta la proyección", async () => {
    const sin = await calcular(periodo(9), empleado());
    const con = await calcular(periodo(9), empleado({ bonoIncentivo: 250 }));
    expect(Number(con.resultado.rentaBrutaProyectada) - Number(sin.resultado.rentaBrutaProyectada)).toBe(1000);
    expect(con.input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "BONO_INCENTIVO")?.tratamiento).toBe("GRAVADO");
  });

  it("42) recalcular es determinista (misma entrada, mismo resultado, sin mutar)", async () => {
    const e = empleado({ inicioLaboral: "2026-09-07", bonoIncentivo: 250 });
    const a = await calcular(periodo(9), e);
    const b = await calcular(periodo(9), e);
    expect(a.input).toEqual(b.input);
    expect(a.resultado).toEqual(b.resultado);
    expect(e).toEqual(empleado({ inicioLaboral: "2026-09-07", bonoIncentivo: 250 }));
  });

  it("43) sin antecedentes confirmados el cálculo sigue bloqueado (no se asume cero)", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({ ultima: null, confirmada: null, revisiones: [] });
    await expect(calcular(periodo(9), empleado({ inicioLaboral: "2026-09-07" }))).rejects.toThrow(ErrorFiscalPlanilla2026);
  });

  it("36-40) exentos, aguinaldo/Bono 14, IGSS deducible y retenciones previas: cubiertos por el motor puro sin cambios (fiscal-isr-2026.test.ts) — aquí se verifica que el adapter los sigue entregando", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 6000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 289.8, isr: 120, conceptos_snapshot: null, mes_periodo: 6, anio_periodo: 2026 },
    ], []]);
    const { input, resultado } = await calcular(periodo(9), empleado());
    expect(input.isrRetenidoPropioQ).toBe("120.00"); // ISR ya retenido por esta empresa
    expect(input.igssLaboralPropio.acumuladoQ).toBe("289.80"); // IGSS ya retenido
    expect(Number(resultado.isrRetenidoPropio)).toBe(120);
    expect(input.limitesExencionAnual).toEqual([]);
  });
});

describe("HORAS EXTRA — fórmula vigente", () => {
  it("29) la hora extra paga al menos 1.5 × la hora ordinaria (sueldo / 240 h)", () => {
    expect(RECARGO_HORA_EXTRA).toBeGreaterThanOrEqual(1.5);
    const sueldo = 6000;
    const ordinaria = tarifaHoraOrdinaria(sueldo);
    expect(ordinaria).toBe(25);
    const { monto } = calcularMontoHorasExtra(sueldo, 4);
    expect(monto).toBeGreaterThanOrEqual(ordinaria * 1.5 * 4);
    expect(monto).toBe(150);
  });
});

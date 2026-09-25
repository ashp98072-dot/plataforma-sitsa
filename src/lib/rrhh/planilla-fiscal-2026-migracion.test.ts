import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("./fiscal-antecedentes", () => ({ leerAntecedentesFiscalesTx: vi.fn() }));

import { leerAntecedentesFiscalesTx } from "./fiscal-antecedentes";
import { calcularFiscal2026Empleado, construirInputFiscalEmpleado2026, ErrorFiscalPlanilla2026 } from "./planilla-fiscal-2026";
import { pendientesVacios } from "./planilla-conceptos";
import { MSG_MIGRACION_SOLAPADA } from "./fiscal-modelo";

/**
 * ACUMULADO INICIAL DE MIGRACIÓN en el motor ISR 2026 (adapter + motor REAL). Empleado antiguo (desde 2017); el sistema anterior
 * procesó enero–septiembre 2026 y el nuevo empieza el 01/10/2026. El acumulado alimenta los mismos campos que los antecedentes
 * (gravado, exento, IGSS, ISR retenido) conservando origen MIGRACION_SISTEMA_ANTERIOR; las planillas nuevas autorizadas se SUMAN
 * además (nunca reemplazan ni duplican el acumulado) y un período autorizado que se solape con enero→corte bloquea.
 */
const conn = { query: vi.fn() };
type Antecedentes = Awaited<ReturnType<typeof leerAntecedentesFiscalesTx>>;
const revisionMigracion = (over: Record<string, unknown> = {}): Antecedentes => ({
  ultima: null, revisiones: [],
  confirmada: {
    id: 1, revision: 4, creadoPor: "rrhh", creadoEn: "2026-10-01", confirmadoPor: "gerente", confirmadoEn: "2026-10-02",
    inicioFiscal: "2026-01-01", corteAntecedentes: "2026-09-30",
    ingresosGravadosPrevios: "45000.00", ingresosExentosPrevios: "2000.00", igssLaboralPrevio: "2173.50", isrRetenidoPrevio: "1250.00",
    datos: {
      version: 1, declaracionAntecedentes: "ACUMULADO_INICIAL_MIGRACION", constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [],
      otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] },
      migracion: { referenciaOrigen: "Sistema anterior de planillas", observacion: null, documentoId: null },
    },
    ...over,
  },
});
const periodo = (mes: number, fechaInicio?: string, id = 10) => ({ id, mes, fechaInicio: fechaInicio ?? `2026-${String(mes).padStart(2, "0")}-01` });
const antiguo = (over: Record<string, unknown> = {}) => ({ id: 7, codigo: "E7", sueldo: 6000, bonoIncentivo: 0, bonoHerramientas: 0, inicioLaboral: "2017-03-01", finLaboral: null, ...over });
const sueldoProyectado = (input: Awaited<ReturnType<typeof construirInputFiscalEmpleado2026>>["input"]) =>
  input.ingresosPropiosProyectadosRestantes.filter((c) => c.codigoConcepto === "SUELDO_BASE").reduce((s, c) => s + Number(c.monto), 0);
/** Línea de una planilla autorizada del sistema NUEVO (v1 con solo sueldo: se acepta como gravado). */
const lineaAutorizada = (sueldo: number, inicio: string, mes: number) => ({
  sueldo_base: sueldo, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: Math.round(sueldo * 4.83) / 100, isr: 0,
  conceptos_snapshot: null, mes_periodo: mes, anio_periodo: 2026, fecha_inicio_periodo: inicio,
});

beforeEach(() => {
  vi.resetAllMocks();
  conn.query.mockResolvedValue([[], []]);
  vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(revisionMigracion());
});

describe("MOTOR — el acumulado de migración alimenta el cálculo", () => {
  it("24) el empleado antiguo puede calcular/generar tras confirmar la migración (NO bloquea por antecedentes)", async () => {
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios())).resolves.toBeDefined();
  });

  it("15-18) gravado, exento, IGSS e ISR retenido previos llegan al motor como antecedentes (caso real del ticket)", async () => {
    const { input, antecedenteRevision } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios());
    expect(input.antecedentes).toEqual({ ingresosGravadosQ: "45000.00", ingresosExentosQ: "2000.00", igssLaboralQ: "2173.50", isrRetenidoQ: "1250.00" });
    expect(antecedenteRevision).toBe(4);
  });

  it("origen MIGRACION_SISTEMA_ANTERIOR (tipo, corte y revisión) queda para el snapshot/auditoría", async () => {
    const { origenFiscal } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios());
    expect(origenFiscal).toEqual({ tipo: "ACUMULADO_INICIAL_MIGRACION", origen: "MIGRACION_SISTEMA_ANTERIOR", fechaCorte: "2026-09-30", revision: 4 });
  });

  it("21) NO proyecta meses anteriores al corte: octubre → diciembre = 3 meses (Q18,000), no 12", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios());
    expect(sueldoProyectado(input)).toBe(18000);
    expect(input.periodosRestantes).toBe(3);
    expect(input.ingresosPropiosAcumulados).toHaveLength(0); // no hay planillas propias todavía: solo el acumulado de migración
  });

  it("el motor arranca desde el acumulado: renta bruta = migración (45,000 + 2,000 exento) + octubre–diciembre; ISR previo se resta del anual", async () => {
    const { resultado } = await calcularFiscal2026Empleado(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios());
    expect(Number(resultado.rentaBrutaProyectada)).toBe(65000); // 45,000 + 2,000 + 18,000
    expect(Number(resultado.rentaExenta)).toBe(2000);
    expect(Number(resultado.isrRetenidoPrevio)).toBe(1250);
    expect(Number(resultado.saldoIsr)).toBeCloseTo(Number(resultado.isrAnual) - 1250, 2); // no empieza otra vez desde el ISR anual completo
    expect(Number(resultado.igssDeducible)).toBeGreaterThanOrEqual(2173.5); // IGSS de migración deducible
  });

  it("19/20) planillas nuevas AUTORIZADAS posteriores al corte se suman ADEMÁS del acumulado, sin duplicarlo ni reemplazarlo", async () => {
    // Noviembre: octubre (Q1 y Q2 nuevas) ya autorizado en el sistema nuevo
    conn.query.mockResolvedValue([[lineaAutorizada(3000, "2026-10-01", 10), lineaAutorizada(3000, "2026-10-16", 10)], []]);
    const { input, resultado } = await calcularFiscal2026Empleado(conn as never, 3, 2026, periodo(11, "2026-11-01", 12), antiguo(), pendientesVacios());
    expect(input.antecedentes?.ingresosGravadosQ).toBe("45000.00"); // el acumulado inicial NO se reemplaza…
    expect(Number(input.ingresosPropiosAcumulados[0].monto)).toBe(6000); // …y octubre entra UNA vez como acumulado propio
    expect(sueldoProyectado(input)).toBe(12000); // noviembre + diciembre
    expect(Number(resultado.rentaBrutaProyectada)).toBe(45000 + 2000 + 6000 + 12000);
  });

  it("corte a mitad de mes (15/09): el mes del corte solo proyecta desde el día siguiente (no duplica la primera mitad)", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(revisionMigracion({ corteAntecedentes: "2026-09-15" }));
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9, "2026-09-16"), antiguo(), pendientesVacios());
    expect(sueldoProyectado(input)).toBe(3000 + 18000); // 16–30/09 (15 días) + octubre–diciembre
  });

  it("empleado que ingresó DESPUÉS del corte: la proyección respeta su ingreso (y el acumulado previo se conserva)", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo({ inicioLaboral: "2026-11-16" }), pendientesVacios());
    expect(sueldoProyectado(input)).toBe(3000 + 6000); // 15 días de noviembre + diciembre
  });
});

describe("MOTOR — anti doble conteo (crítico)", () => {
  it("22) una planilla AUTORIZADA que se solapa con enero→corte (16/09–30/09) bloquea con mensaje explícito, no continúa en silencio", async () => {
    conn.query.mockResolvedValue([[lineaAutorizada(3000, "2026-09-16", 9)], []]);
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios())).rejects.toThrow(MSG_MIGRACION_SOLAPADA);
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios())).rejects.toThrow(ErrorFiscalPlanilla2026);
  });

  it("un período autorizado en el corte exacto (inicio = corte) también se rechaza; uno del día siguiente no", async () => {
    conn.query.mockResolvedValue([[lineaAutorizada(200, "2026-09-30", 9)], []]);
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios())).rejects.toThrow(MSG_MIGRACION_SOLAPADA);
    conn.query.mockResolvedValue([[lineaAutorizada(3000, "2026-10-01", 10)], []]);
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(11, "2026-11-01", 12), antiguo(), pendientesVacios())).resolves.toBeDefined();
  });

  it("23) el período que se calcula debe ser POSTERIOR al corte (01/10 con corte 30/09 es válido; 16/09 no)", async () => {
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10, "2026-10-01"), antiguo(), pendientesVacios())).resolves.toBeDefined();
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9, "2026-09-16"), antiguo(), pendientesVacios())).rejects.toThrow(MSG_MIGRACION_SOLAPADA);
  });

  it("la misma protección aplica a la revalidación al autorizar (mismo adapter): si el corte se vuelve incoherente, bloquea", async () => {
    // Revisión nueva confirmada con otro corte → revision distinta y, si se solapa, error; nunca se autoriza con fiscal viejo.
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(revisionMigracion({ revision: 5, corteAntecedentes: "2026-10-15" }));
    await expect(calcularFiscal2026Empleado(conn as never, 3, 2026, periodo(10, "2026-10-01"), antiguo(), pendientesVacios())).rejects.toThrow(MSG_MIGRACION_SOLAPADA);
  });
});

describe("MOTOR — regresión de los otros orígenes", () => {
  const confirmadaBase = (declaracion: string, extra: Record<string, unknown> = {}): Antecedentes => ({
    ultima: null, revisiones: [],
    confirmada: {
      id: 1, revision: 3, creadoPor: "rrhh", creadoEn: "2026-01-01", confirmadoPor: "rrhh", confirmadoEn: "2026-01-02",
      inicioFiscal: null, corteAntecedentes: null, ingresosGravadosPrevios: "0.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00",
      datos: { version: 1, declaracionAntecedentes: declaracion, constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [], otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] } },
      ...extra,
    } as never,
  });

  it("25) SIN_ANTECEDENTES sigue funcionando: antecedentes null y origen SIN_ANTECEDENTES", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(confirmadaBase("SIN_ANTECEDENTES"));
    const r = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9), antiguo({ inicioLaboral: "2026-09-07" }), pendientesVacios());
    expect(r.input.antecedentes).toBeNull();
    expect(r.origenFiscal).toMatchObject({ tipo: "SIN_ANTECEDENTES", origen: "SIN_ANTECEDENTES", fechaCorte: null });
  });

  it("26/27) CON_ANTECEDENTES (otro patrono) sigue funcionando con sus importes y origen ANTECEDENTES", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(confirmadaBase("CON_ANTECEDENTES", {
      ingresosGravadosPrevios: "10000.00", ingresosExentosPrevios: "500.00", igssLaboralPrevio: "483.00", isrRetenidoPrevio: "300.00", corteAntecedentes: "2026-03-31", inicioFiscal: "2026-01-01" }));
    const r = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(9, "2026-09-01"), antiguo(), pendientesVacios());
    expect(r.input.antecedentes).toEqual({ ingresosGravadosQ: "10000.00", ingresosExentosQ: "500.00", igssLaboralQ: "483.00", isrRetenidoQ: "300.00" });
    expect(r.origenFiscal).toMatchObject({ tipo: "ANTECEDENTES_OTRO_PATRONO", origen: "ANTECEDENTES" });
    // sin restricción de fechas de migración: un período de mayo con antecedentes de otro patrono no se rechaza por corte
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(5, "2026-05-01"), antiguo(), pendientesVacios())).resolves.toBeDefined();
  });

  it("28) empleado sin NINGUNA revisión confirmada sigue bloqueado", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({ ultima: null, confirmada: null, revisiones: [] });
    await expect(construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios())).rejects.toThrow(/no tiene antecedentes fiscales 2026 confirmados/);
  });

  it("29) la revisión fiscal usada viaja en el resultado: si cambia entre generar y autorizar, el recálculo lo detecta (antecedenteRevision)", async () => {
    const a = await calcularFiscal2026Empleado(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios());
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(revisionMigracion({ revision: 5, ingresosGravadosPrevios: "46000.00" }));
    const b = await calcularFiscal2026Empleado(conn as never, 3, 2026, periodo(10), antiguo(), pendientesVacios());
    expect([a.antecedenteRevision, b.antecedenteRevision]).toEqual([4, 5]);
    expect(JSON.stringify(a.input)).not.toBe(JSON.stringify(b.input));
  });
});

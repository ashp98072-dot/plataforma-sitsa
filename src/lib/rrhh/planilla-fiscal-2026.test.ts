import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("./fiscal-antecedentes", () => ({ leerAntecedentesFiscales: vi.fn() }));

import { leerAntecedentesFiscales } from "./fiscal-antecedentes";
import {
  calcularFiscal2026Empleado,
  construirInputFiscalEmpleado2026,
  ErrorFiscalPlanilla2026,
} from "./planilla-fiscal-2026";
import { pendientesVacios } from "./planilla-conceptos";

/**
 * RRHH-PLANILLAS-ISR-2026-INTEGRACION — pruebas del adapter en aislamiento
 * (sin pasar por generarLineasPeriodo/autorizarPeriodoPlanilla; esas se
 * cubren en planillas-fiscal-2026-integracion.test.ts). `calcularFiscal2026Empleado`
 * invoca el motor puro REAL (fiscal-isr-2026.ts, ya probado por separado) —
 * aquí solo se verifica que el adapter arma el input correcto y bloquea
 * cuando corresponde.
 */

const conn = { query: vi.fn() };

type AntecedentesFiscales = Awaited<ReturnType<typeof leerAntecedentesFiscales>>;

const antecedenteConfirmado = (overrides: Partial<Record<string, unknown>> = {}): AntecedentesFiscales => ({
  ultima: null,
  revisiones: [],
  confirmada: {
    id: 1,
    revision: 3,
    creadoPor: "rrhh",
    creadoEn: "2026-01-01",
    confirmadoPor: "rrhh",
    confirmadoEn: "2026-01-02",
    inicioFiscal: "2026-01-01",
    corteAntecedentes: "2026-01-31",
    ingresosGravadosPrevios: "0.00",
    ingresosExentosPrevios: "0.00",
    igssLaboralPrevio: "0.00",
    isrRetenidoPrevio: "0.00",
    datos: {
      version: 1,
      declaracionAntecedentes: "SIN_ANTECEDENTES",
      constancias: [],
      ingresosPreviosPorConcepto: [],
      ajustesPrevios: [],
      deducciones: [],
      otrosPatronos: { declaracion: "NO", agenteRetenedor: "PENDIENTE", remuneraciones: [] },
    },
    ...overrides,
  },
});

const periodo = { id: 10, mes: 9, fechaInicio: "2026-09-01" };
const empleado = { id: 7, codigo: "E7", sueldo: 4000, bonoIncentivo: 0, bonoHerramientas: 0 };

beforeEach(() => {
  vi.resetAllMocks();
  conn.query.mockResolvedValue([[], []]); // sin períodos previos por defecto
});

describe("construirInputFiscalEmpleado2026 — antecedentes", () => {
  it("3. sin antecedente confirmado: bloquea con mensaje explícito", async () => {
    vi.mocked(leerAntecedentesFiscales).mockResolvedValue({ ultima: null, confirmada: null, revisiones: [] });
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(ErrorFiscalPlanilla2026);
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(/antecedentes fiscales 2026 confirmados/);
  });

  it("7. antecedente NO confirmado (solo borrador/`ultima`) no sirve: sigue bloqueando", async () => {
    vi.mocked(leerAntecedentesFiscales).mockResolvedValue({
      ultima: { revision: 5 } as never, confirmada: null, revisiones: [],
    });
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(ErrorFiscalPlanilla2026);
  });

  it("8. SIN_ANTECEDENTES confirmado permite continuar (antecedentes=null en el input)", async () => {
    vi.mocked(leerAntecedentesFiscales).mockResolvedValue(antecedenteConfirmado());
    const { input, antecedenteRevision } = await construirInputFiscalEmpleado2026(
      conn as never, 3, 2026, periodo, empleado, pendientesVacios(),
    );
    expect(input.antecedentes).toBeNull();
    expect(antecedenteRevision).toBe(3);
  });

  it("6. antecedente CON_ANTECEDENTES confirmado se incorpora al input", async () => {
    vi.mocked(leerAntecedentesFiscales).mockResolvedValue(antecedenteConfirmado({
      datos: { ...antecedenteConfirmado().confirmada!.datos, declaracionAntecedentes: "CON_ANTECEDENTES" },
      ingresosGravadosPrevios: "10000.00", ingresosExentosPrevios: "500.00",
      igssLaboralPrevio: "483.00", isrRetenidoPrevio: "300.00",
    }));
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.antecedentes).toEqual({
      ingresosGravadosQ: "10000.00", ingresosExentosQ: "500.00",
      igssLaboralQ: "483.00", isrRetenidoQ: "300.00",
    });
  });
});

describe("construirInputFiscalEmpleado2026 — conceptos PENDIENTES bloquean", () => {
  beforeEach(() => vi.mocked(leerAntecedentesFiscales).mockResolvedValue(antecedenteConfirmado()));

  it("9. bono incentivo distinto de cero bloquea (sin configuración fiscal publicada)", async () => {
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, { ...empleado, bonoIncentivo: 250 }, pendientesVacios()),
    ).rejects.toThrow(/[Bb]ono incentivo.*PENDIENTE/);
  });

  it("bono herramientas distinto de cero bloquea", async () => {
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, { ...empleado, bonoHerramientas: 100 }, pendientesVacios()),
    ).rejects.toThrow(/[Bb]ono herramientas.*PENDIENTE/);
  });

  it("10. prestación de texto libre (rrhh_prestaciones) distinta de cero bloquea", async () => {
    const pendientes = { ...pendientesVacios(), prestacionesLegado: [{ id: 1, monto: 500, concepto: "Aguinaldo", fecha: "2026-09-01", notas: "" }] };
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientes),
    ).rejects.toThrow(/Prestación "Aguinaldo".*PENDIENTE/);
  });

  it("horas extra SÍ están asentadas como gravadas: no bloquean", async () => {
    const pendientes = { ...pendientesVacios(), horasExtra: [{ id: 1, monto: 125, horas: 5, concepto: "Horas extra", fecha: "2026-09-01", notas: "" }] };
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientes);
    const he = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "HORAS_EXTRA");
    expect(he).toMatchObject({ tratamiento: "GRAVADO", monto: "125.00" });
  });

  it("reporta TODOS los conceptos bloqueantes de una vez, no solo el primero", async () => {
    const pendientes = { ...pendientesVacios(), prestacionesLegado: [{ id: 1, monto: 75, concepto: "Otro", fecha: "2026-09-01", notas: "" }] };
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, { ...empleado, bonoIncentivo: 250, bonoHerramientas: 50 }, pendientes),
    ).rejects.toThrow(/[Bb]ono incentivo[\s\S]*[Bb]ono herramientas[\s\S]*Prestación/);
  });
});

describe("construirInputFiscalEmpleado2026 — acumulados y proyección", () => {
  beforeEach(() => vi.mocked(leerAntecedentesFiscales).mockResolvedValue(antecedenteConfirmado()));

  it("proyecta sueldo mensual × meses restantes incluyendo el mes actual", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    // periodo.mes = 9 (septiembre) -> restantes = 13 - 9 = 4 (sep, oct, nov, dic)
    expect(input.periodosRestantes).toBe(4);
    const sueldoProyectado = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "SUELDO_BASE");
    expect(sueldoProyectado?.monto).toBe("16000.00"); // 4000 * 4
  });

  it("3/5/11. acumulados de períodos ya autorizados se incorporan UNA sola vez (no se duplican, no re-clasifica)", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 250, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 150 },
    ], []]);
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.ingresosPropiosAcumulados).toHaveLength(1);
    expect(input.ingresosPropiosAcumulados[0]).toMatchObject({ tratamiento: "GRAVADO", monto: "4250.00" });
    expect(input.igssLaboralPropio.acumuladoQ).toBe("193.20");
    expect(input.isrRetenidoPropioQ).toBe("150.00");
    // La consulta excluye explícitamente el período actual y exige autorización.
    expect(conn.query.mock.calls[0][0]).toContain("p.autorizado_en IS NOT NULL");
    expect(conn.query.mock.calls[0][0]).toContain("p.id <> ?");
    expect(conn.query.mock.calls[0][1]).toEqual([3, 7, 2026, 10]);
  });

  it("4. un borrador/regenerado no cuenta como retención ya ejecutada (la consulta ya lo excluye por autorizado_en IS NOT NULL)", async () => {
    // El mock de conn.query no filtra por SQL real, pero la aserción de la
    // consulta (arriba) prueba que el filtro SQL exige autorizado_en IS NOT
    // NULL; aquí se prueba el caso "no hay ninguno autorizado todavía".
    conn.query.mockResolvedValue([[], []]);
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.ingresosPropiosAcumulados).toEqual([]);
    expect(input.isrRetenidoPropioQ).toBe("0.00");
  });
});

describe("calcularFiscal2026Empleado — integra el motor puro real", () => {
  beforeEach(() => vi.mocked(leerAntecedentesFiscales).mockResolvedValue(antecedenteConfirmado()));

  it("18. determinista: misma entrada produce siempre el mismo resultado", async () => {
    const r1 = await calcularFiscal2026Empleado(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    const r2 = await calcularFiscal2026Empleado(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(r1.resultado).toEqual(r2.resultado);
  });

  it("20. posible devolución no genera retención negativa", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 0, isr: 999999 },
    ], []]);
    const { resultado } = await calcularFiscal2026Empleado(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(Number(resultado.retencionSugerida)).toBeGreaterThanOrEqual(0);
    expect(resultado.retencionSugerida).toBe("0.00");
  });
});

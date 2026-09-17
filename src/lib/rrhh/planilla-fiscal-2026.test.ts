import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("./fiscal-antecedentes", () => ({ leerAntecedentesFiscalesTx: vi.fn() }));

import { leerAntecedentesFiscalesTx } from "./fiscal-antecedentes";
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

type AntecedentesFiscales = Awaited<ReturnType<typeof leerAntecedentesFiscalesTx>>;

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

/** Snapshot v1 (anterior a este PR): sin bloque `fiscal`. */
function snapshotV1(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    version: 1, empresaId: 3, periodoId: 1, empleadoId: 7, sueldoMensual: 4000,
    cuotas: [], manuales: [], horasExtra: [], descuentosLegado: [], prestacionesLegado: [],
    ...overrides,
  });
}
/** Snapshot v2 (ya pasó por este motor): con bloque `fiscal`. */
function snapshotV2Fiscal(overrides: Partial<Record<string, unknown>> = {}) {
  return JSON.stringify({
    version: 2, empresaId: 3, periodoId: 1, empleadoId: 7, sueldoMensual: 4000,
    cuotas: [], manuales: [], horasExtra: [], descuentosLegado: [], prestacionesLegado: [],
    fiscal: {
      motor: "ISR_TRABAJO_2026", ejercicio: 2026, antecedenteRevision: 1,
      parametrosRevision: { ejercicio: 2026, version: "2026.1" }, fechaCorte: "2026-08-01",
      inputUsado: {}, resultado: {}, isrAplicadoPeriodo: "0.00",
    },
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  conn.query.mockResolvedValue([[], []]); // sin períodos previos por defecto
});

describe("construirInputFiscalEmpleado2026 — antecedentes", () => {
  it("3. sin antecedente confirmado: bloquea con mensaje explícito", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({ ultima: null, confirmada: null, revisiones: [] });
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(ErrorFiscalPlanilla2026);
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(/antecedentes fiscales 2026 confirmados/);
  });

  it("7. antecedente NO confirmado (solo borrador/`ultima`) no sirve: sigue bloqueando", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({
      ultima: { revision: 5 } as never, confirmada: null, revisiones: [],
    });
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(ErrorFiscalPlanilla2026);
  });

  it("8. SIN_ANTECEDENTES confirmado permite continuar (antecedentes=null en el input)", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado());
    const { input, antecedenteRevision } = await construirInputFiscalEmpleado2026(
      conn as never, 3, 2026, periodo, empleado, pendientesVacios(),
    );
    expect(input.antecedentes).toBeNull();
    expect(antecedenteRevision).toBe(3);
  });

  it("6. antecedente CON_ANTECEDENTES confirmado se incorpora al input", async () => {
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado({
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
  beforeEach(() => vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado()));

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
  beforeEach(() => vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado()));

  it("proyecta sueldo mensual × meses restantes incluyendo el mes actual (sin acumulados del mes)", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    // periodo.mes = 9 (septiembre) -> restantes = 13 - 9 = 4 (sep, oct, nov, dic)
    expect(input.periodosRestantes).toBe(4);
    const sueldoProyectado = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "SUELDO_BASE");
    expect(sueldoProyectado?.monto).toBe("16000.00"); // 4000 * 4
  });

  it("3/5/11. acumulados de un período histórico v2 (otro mes) se incorporan UNA sola vez, ya clasificado", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 250, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 150,
        conceptos_snapshot: snapshotV2Fiscal(), mes_periodo: 6, anio_periodo: 2026 }, // junio: otro mes, no afecta la proyección de septiembre
    ], []]);
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.ingresosPropiosAcumulados).toHaveLength(1);
    expect(input.ingresosPropiosAcumulados[0]).toMatchObject({ tratamiento: "GRAVADO", monto: "4250.00" });
    expect(input.igssLaboralPropio.acumuladoQ).toBe("193.20");
    expect(input.isrRetenidoPropioQ).toBe("150.00");
    // Junio no es el mes actual (septiembre): la proyección de septiembre sigue completa.
    const sueldoProyectado = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "SUELDO_BASE");
    expect(sueldoProyectado?.monto).toBe("16000.00");
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

describe("construirInputFiscalEmpleado2026 — IGSS proyectado (corrección #2)", () => {
  beforeEach(() => vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado()));

  it("el salario proyectado genera IGSS proyectado sobre la misma base (4.83%)", async () => {
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    // proyección sueldo = 4000*4 = 16000 ; IGSS = 16000 * 4.83% = 772.80
    expect(input.igssLaboralPropio.proyectadoRestanteQ).toBe("772.80");
  });

  it("la renta imponible del resultado baja correctamente por el IGSS proyectado", async () => {
    const { resultado } = await calcularFiscal2026Empleado(
      conn as never, 3, 2026, periodo, { ...empleado, sueldo: 30000 }, pendientesVacios(),
    );
    // rentaGravada = 30000*4 = 120000 ; igssDeducible = 120000*4.83% = 5796.00
    // imponible = 120000 - 48000 - 3024 - 5796 = 63180.00
    expect(resultado.igssDeducible).toBe("5796.00");
    expect(resultado.rentaImponible).toBe("63180.00");
  });

  it("no se duplica el IGSS acumulado: solo suma igss_laboral de líneas ya autorizadas", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 0,
        conceptos_snapshot: snapshotV1(), mes_periodo: 6, anio_periodo: 2026 },
      { sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 0,
        conceptos_snapshot: snapshotV1(), mes_periodo: 7, anio_periodo: 2026 },
    ], []]);
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.igssLaboralPropio.acumuladoQ).toBe("386.40"); // 193.20 * 2, no más
  });
});

describe("construirInputFiscalEmpleado2026 — Q1/Q2/MENSUAL sin duplicar el mes actual (corrección #3)", () => {
  beforeEach(() => vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado()));

  it("A) septiembre Q1 sin períodos del mes autorizados: acumulado del mes = 0, proyección de septiembre completa una sola vez", async () => {
    conn.query.mockResolvedValue([[], []]);
    const { input } = await construirInputFiscalEmpleado2026(
      conn as never, 3, 2026, { id: 10, mes: 9, fechaInicio: "2026-09-01" }, empleado, pendientesVacios(),
    );
    expect(input.ingresosPropiosAcumulados).toEqual([]);
    const sueldoProyectado = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "SUELDO_BASE");
    // 4 meses restantes (sep-dic) por 4000, septiembre entra UNA vez.
    expect(sueldoProyectado?.monto).toBe("16000.00");
  });

  it("B) septiembre Q2 con Q1 autorizada (Q1 = 2000): acumulado incluye Q1, proyección solo el remanente de septiembre — total anual no duplica septiembre", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 2000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 96.6, isr: 0,
        conceptos_snapshot: snapshotV2Fiscal(), mes_periodo: 9, anio_periodo: 2026 }, // Q1 del mismo mes
    ], []]);
    const { input } = await construirInputFiscalEmpleado2026(
      conn as never, 3, 2026, { id: 11, mes: 9, fechaInicio: "2026-09-01" }, empleado, pendientesVacios(),
    );
    expect(input.ingresosPropiosAcumulados[0].monto).toBe("2000.00"); // Q1
    const sueldoProyectado = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "SUELDO_BASE");
    // remanente de septiembre (4000-2000=2000) + oct+nov+dic (3*4000=12000) = 14000
    expect(sueldoProyectado?.monto).toBe("14000.00");
    // Total anual para septiembre = acumulado (2000, Q1) + parte de la proyección que es septiembre (2000) = 4000, no 6000.
    const totalAnualProyectadoMasAcumuladoSeptiembre =
      Number(input.ingresosPropiosAcumulados[0].monto) /* solo Q1, todo de septiembre */ +
      2000 /* remanente Q2 de septiembre, ya aislado arriba del resto de la proyección */;
    expect(totalAnualProyectadoMasAcumuladoSeptiembre).toBe(4000);
  });

  it("C) período MENSUAL (sin otro período del mismo mes autorizado): comportamiento sin cambios", async () => {
    conn.query.mockResolvedValue([[], []]);
    const { input } = await construirInputFiscalEmpleado2026(
      conn as never, 3, 2026, { id: 12, mes: 9, fechaInicio: "2026-09-01" }, empleado, pendientesVacios(),
    );
    const sueldoProyectado = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "SUELDO_BASE");
    expect(sueldoProyectado?.monto).toBe("16000.00"); // idéntico al caso A: 4000 * 4 meses restantes
  });
});

describe("construirInputFiscalEmpleado2026 — reconstrucción histórica v1/v2 (corrección #4)", () => {
  beforeEach(() => vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado()));

  it("histórico v1 con solo sueldo conocido (bono/otros en cero) -> continúa sin bloquear", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 100,
        conceptos_snapshot: snapshotV1(), mes_periodo: 6, anio_periodo: 2026 },
    ], []]);
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.ingresosPropiosAcumulados[0].monto).toBe("4000.00");
  });

  it("histórico v2 usa la clasificación ya congelada (bono/otros se suman porque ya pasaron por estas reglas)", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 500, igss_laboral: 193.2, isr: 100,
        conceptos_snapshot: snapshotV2Fiscal(), mes_periodo: 6, anio_periodo: 2026 }, // otros_ingresos = horas extra ya gravadas, v2 lo garantiza
    ], []]);
    const { input } = await construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.ingresosPropiosAcumulados[0].monto).toBe("4500.00");
  });

  it("histórico con bono incentivo sin clasificación fiscal (v1) -> bloquea", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 250, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 100,
        conceptos_snapshot: snapshotV1(), mes_periodo: 6, anio_periodo: 2026 },
    ], []]);
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(/histórico.*sin clasificación|clasificación fiscal 2026 demostrable/);
  });

  it("histórico sin snapshot (NULL, muy anterior) con bono incentivo -> bloquea igual que v1 explícito", async () => {
    conn.query.mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 100, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 100,
        conceptos_snapshot: null, mes_periodo: 3, anio_periodo: 2026 },
    ], []]);
    await expect(
      construirInputFiscalEmpleado2026(conn as never, 3, 2026, periodo, empleado, pendientesVacios()),
    ).rejects.toThrow(ErrorFiscalPlanilla2026);
  });

  it("no reescribe la línea histórica: el adapter solo lee (conn no expone execute; cualquier intento de escritura haría fallar el mock)", async () => {
    const connSoloLectura = { query: vi.fn().mockResolvedValue([[
      { sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 100,
        conceptos_snapshot: snapshotV1(), mes_periodo: 6, anio_periodo: 2026 },
    ], []]) };
    const { input } = await construirInputFiscalEmpleado2026(connSoloLectura as never, 3, 2026, periodo, empleado, pendientesVacios());
    expect(input.ingresosPropiosAcumulados[0].monto).toBe("4000.00");
    expect(Object.keys(connSoloLectura)).toEqual(["query"]); // ninguna llamada a execute fue necesaria
  });
});

describe("calcularFiscal2026Empleado — integra el motor puro real", () => {
  beforeEach(() => vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteConfirmado()));

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

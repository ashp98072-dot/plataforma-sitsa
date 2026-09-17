import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("./isr", () => ({ calcularISRMensual: () => 999 })); // testigo: si esto se usa en 2026, los tests fallarían.
vi.mock("./fiscal-antecedentes", () => ({ leerAntecedentesFiscalesTx: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { leerAntecedentesFiscalesTx } from "./fiscal-antecedentes";
import { generarLineasPeriodo, autorizarPeriodoPlanilla } from "./planillas";
import { leerConceptosSnapshot } from "./planilla-conceptos";
import * as fiscalIsr2026 from "./fiscal-isr-2026";
import * as fiscalConceptos2026 from "./fiscal-conceptos-2026";
import { redondearQ } from "./contratos-pago";

/**
 * RRHH-PLANILLAS-ISR-2026-INTEGRACION — pruebas de extremo a extremo de
 * generarLineasPeriodo/autorizarPeriodoPlanilla para el ejercicio 2026,
 * mismo estilo de mocking que planillas-autorizacion.test.ts (fuentes
 * reales simuladas vía conn.query/conn.execute). El motor puro
 * (calcularIsrTrabajo2026) y el adapter (planilla-fiscal-2026.ts) corren
 * REALES, sin mockear — solo se mockea la fuente de antecedentes
 * (fiscal-antecedentes.ts) y el acceso a datos.
 */

type Row = Record<string, unknown>;
let periodo: Row;
let lineas: Row[];
let sueldo: number;
let bonoIncentivo: number;
let prioridades: Row[]; // líneas de períodos previos ya autorizados del ejercicio (consulta del adapter fiscal)
let q1Datos: Row[]; // datos de QUINCENA_1 para la reconciliación YA existente en planillas.ts (independiente del adapter)
let backup: string;
const conn = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), query: vi.fn(), execute: vi.fn() };
const generar = (empresaId = 3) => generarLineasPeriodo(empresaId, 1, { usuario: "prueba" });
const autorizar = (empresaId = 3) => autorizarPeriodoPlanilla(empresaId, 1, "gerente");

const antecedenteSinAntecedentes = () => ({
  ultima: null, revisiones: [],
  confirmada: {
    id: 1, revision: 1, creadoPor: "rrhh", creadoEn: "2026-01-01", confirmadoPor: "rrhh", confirmadoEn: "2026-01-02",
    inicioFiscal: null, corteAntecedentes: null,
    ingresosGravadosPrevios: null, ingresosExentosPrevios: null, igssLaboralPrevio: null, isrRetenidoPrevio: null,
    datos: {
      version: 1, declaracionAntecedentes: "SIN_ANTECEDENTES", constancias: [], ingresosPreviosPorConcepto: [],
      ajustesPrevios: [], deducciones: [], otrosPatronos: { declaracion: "NO", agenteRetenedor: "PENDIENTE", remuneraciones: [] },
    },
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  sueldo = 4000; bonoIncentivo = 0; lineas = []; prioridades = []; q1Datos = [];
  periodo = { id: 1, empresa_id: 3, codigo: "PRUEBA", estado: "Borrador", autorizado_en: null, autorizado_por: null,
    fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30", tipo_periodo: "MENSUAL", mes: 9, anio: 2026 };
  vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue(antecedenteSinAntecedentes() as never);
  conn.beginTransaction.mockImplementation(async () => { backup = JSON.stringify({ periodo, lineas }); });
  conn.rollback.mockImplementation(async () => { ({ periodo, lineas } = JSON.parse(backup)); });
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  vi.mocked(query).mockImplementation(async (sql, params) => {
    if (sql.includes("FROM rrhh_planilla_periodos")) return (Number(params?.[0]) === 3 ? [periodo] : []) as never;
    if (sql.includes("FROM empleados")) return [{ id: 7, codigo: "E7", nombre: "Empleado", sueldo_base: sueldo, bono_incentivo: bonoIncentivo, bono_herramientas: 0 }] as never;
    if (sql.includes("SELECT l.*")) return lineas.map((l) => ({ ...l, sueldo_mensual: sueldo })) as never;
    return [] as never;
  });
  conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("p.autorizado_en IS NOT NULL")) return [prioridades, []]; // acumulados 2026 del adapter
    if (sql.includes("INNER JOIN rrhh_planilla_lineas")) return [q1Datos, []]; // reconciliación QUINCENA_2 ya existente
    if (sql.includes("FROM empleados")) return [Number(params[0]) === 3 && params.slice(1).includes(7) ? [{ id: 7, codigo: "E7", sueldo_base: sueldo, bono_incentivo: bonoIncentivo, bono_herramientas: 0 }] : [], []];
    if (sql.includes("SELECT id, estado FROM")) return [Number(params[0]) === 3 ? [periodo] : [], []];
    if (sql.includes("SELECT q2.id")) return [[], []];
    if (sql.includes("SELECT autorizado_en") || sql.includes("SELECT * FROM rrhh_planilla_periodos")) return [[periodo], []];
    if (sql.includes("FROM rrhh_planilla_lineas")) return [lineas, []];
    if (sql.includes("FROM rrhh_descuentos_maestro")) return [[], []];
    if (sql.includes("FROM rrhh_descuento_cuotas")) return [[], []];
    if (sql.includes("FROM rrhh_descuento_abonos")) return [[], []];
    if (sql.includes("FROM horas_extra_registros")) return [[], []];
    if (sql.includes("FROM rrhh_descuentos")) return [[], []];
    if (sql.includes("FROM rrhh_prestaciones")) return [[], []];
    return [[], []];
  });
  conn.execute.mockImplementation(async (sql: string, p: unknown[]) => {
    if (sql.includes("INSERT INTO rrhh_planilla_lineas")) {
      const keys = ["empresa_id", "periodo_id", "id_empleado", "codigo_empleado", "nombre_empleado", "dpi", "tipo_contrato", "forma_pago", "sueldo_base", "bono_incentivo", "bono_herramientas", "otros_ingresos", "igss_laboral", "igss_patronal", "descuentos", "isr", "neto", "estado_pago", "ref_pago", "conceptos_snapshot"];
      lineas = [{ ...Object.fromEntries(keys.map((k, i) => [k, p[i]])), id: lineas[0]?.id ?? 100 }];
    } else if (sql.includes("UPDATE rrhh_planilla_periodos")) {
      if (sql.includes("autorizado_en = NOW()")) { periodo.estado = "Cerrada"; periodo.autorizado_por = p[0]; periodo.autorizado_en = "2026-09-30 12:00:00"; }
      else periodo.estado = "Generada";
    }
    return [{ affectedRows: 1 }, []];
  });
});

describe("2026 activa el motor nuevo; otros ejercicios no", () => {
  it("1. planilla 2026 usa el motor nuevo (snapshot v2 con fiscal, calcularISRMensual NO se usa)", async () => {
    await generar();
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    expect(s.version).toBe(2);
    expect(s.fiscal?.motor).toBe("ISR_TRABAJO_2026");
    expect(s.fiscal?.ejercicio).toBe(2026);
    expect(Number(lineas[0].isr)).not.toBe(999); // 999 sería la señal de que se usó el mock de isr.ts
  });

  it("2. ejercicio != 2026 no reutiliza el motor 2026 (usa isr.ts sin cambios)", async () => {
    periodo.fecha_inicio = "2025-09-01"; periodo.fecha_fin = "2025-09-30"; periodo.anio = 2025;
    await generar();
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    expect(s.version).toBe(1);
    expect(s.fiscal).toBeUndefined();
    expect(Number(lineas[0].isr)).toBe(999); // sí usó calcularISRMensual (mockeado)
    expect(leerAntecedentesFiscalesTx).not.toHaveBeenCalled();
  });
});

describe("acumulados, proyección y no duplicación", () => {
  it("3/9. acumulados de un período 2026 ya autorizado (otro mes) se incorporan al calcular el actual", async () => {
    prioridades = [{ sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 150,
      mes_periodo: 6, anio_periodo: 2026 }]; // junio: otro mes distinto al período actual (septiembre)
    await generar();
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    const input = s.fiscal!.inputUsado as { ingresosPropiosAcumulados: unknown[]; isrRetenidoPropioQ: string };
    expect(input.ingresosPropiosAcumulados).toHaveLength(1);
    expect(input.isrRetenidoPropioQ).toBe("150.00");
  });

  it("5. la línea del período actual no aparece en su propia consulta de acumulados (se excluye por id)", async () => {
    await generar();
    const consulta = conn.query.mock.calls.find(([sql]) => String(sql).includes("p.autorizado_en IS NOT NULL"));
    expect(consulta?.[1]).toEqual([3, 7, 2026, 1]); // el último parámetro (1) es el periodoId excluido
  });

  it("B) Q2 del mismo mes que una Q1 ya autorizada no duplica el mes: acumulado + proyección de septiembre = un solo sueldo", async () => {
    periodo.tipo_periodo = "QUINCENA_2"; periodo.mes = 9;
    prioridades = [{ sueldo_base: 2000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 96.6, isr: 0,
      mes_periodo: 9, anio_periodo: 2026 }]; // Q1 del MISMO mes (septiembre), ya autorizada
    await generar();
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    const input = s.fiscal!.inputUsado as {
      ingresosPropiosAcumulados: { monto: string }[];
      ingresosPropiosProyectadosRestantes: { codigoConcepto: string; monto: string }[];
    };
    expect(input.ingresosPropiosAcumulados[0].monto).toBe("2000.00"); // Q1
    const sueldoProyectado = input.ingresosPropiosProyectadosRestantes.find((c) => c.codigoConcepto === "SUELDO_BASE");
    // remanente de septiembre (4000-2000=2000) + oct+nov+dic (3*4000=12000) = 14000, no 4000*4=16000.
    expect(sueldoProyectado?.monto).toBe("14000.00");
  });

  it("histórico v1 (anterior a este PR) con bono incentivo sin clasificar bloquea toda la generación", async () => {
    prioridades = [{ sueldo_base: 4000, bono_incentivo: 250, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 150,
      mes_periodo: 6, anio_periodo: 2026,
      conceptos_snapshot: JSON.stringify({ version: 1, empresaId: 3, periodoId: 2, empleadoId: 7, sueldoMensual: 4000,
        cuotas: [], manuales: [], horasExtra: [], descuentosLegado: [], prestacionesLegado: [] }) }];
    await expect(generar()).rejects.toThrow(/clasificación fiscal 2026 demostrable/);
    expect(lineas).toEqual([]); // no se insertó ninguna línea: todo o nada
  });
});

describe("IGSS proyectado (corrección #2)", () => {
  it("el snapshot fiscal refleja IGSS proyectado sobre el sueldo proyectado, no en cero", async () => {
    sueldo = 4000;
    await generar();
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    const resultado = s.fiscal!.resultado as { igssDeducible: string };
    // proyección = 4000*4 (sep-dic) = 16000 ; IGSS = 16000*4.83% = 772.80 (sin acumulados en este caso)
    expect(resultado.igssDeducible).toBe("772.80");
  });
});

describe("generar no consume; autorizar consume una vez", () => {
  it("12. generar (incluida la vista previa fiscal) no consume conceptos pendientes ni antecedentes", async () => {
    await generar();
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE rrhh_descuento") || String(sql).includes("UPDATE horas_extra"))).toBe(false);
  });

  it("11. regenerar recalcula el snapshot fiscal (no preserva el ISR anterior como sí hacía el motor viejo)", async () => {
    sueldo = 30000; // por encima de la deducción anual: genera ISR > 0 para comparar
    await generar();
    const primero = lineas[0].isr;
    expect(primero).not.toBe(0);
    sueldo = 45000; // cambia el salario antes de regenerar
    await generar();
    expect(lineas[0].isr).not.toBe(primero);
  });

  it("13/14. autorizar consume una sola vez; doble autorización no duplica ni re-consume", async () => {
    await generar();
    await autorizar();
    expect(periodo.estado).toBe("Cerrada");
    await expect(autorizar()).rejects.toThrow("ya está autorizada");
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(1);
  });

  it("18. una planilla autorizada no se recalcula (autorizar no vuelve a invocar el motor tras congelar)", async () => {
    await generar();
    await autorizar();
    const isrCongelado = lineas[0].isr;
    vi.mocked(leerAntecedentesFiscalesTx).mockClear();
    await expect(autorizar()).rejects.toThrow("ya está autorizada");
    expect(lineas[0].isr).toBe(isrCongelado);
    expect(leerAntecedentesFiscalesTx).not.toHaveBeenCalled();
  });
});

describe("fallar cerrado en autorizar: cualquier cambio del input fiscal exige regenerar", () => {
  it("15. cambio de salario después de generar bloquea autorizar", async () => {
    await generar();
    sueldo = 5000;
    await expect(autorizar()).rejects.toThrow(/información salarial cambió/);
    expect(periodo.estado).toBe("Generada");
  });

  it("16. cambio de antecedentes confirmados después de generar bloquea autorizar", async () => {
    await generar();
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({
      ultima: null, revisiones: [],
      confirmada: { ...antecedenteSinAntecedentes().confirmada, revision: 2, ingresosGravadosPrevios: null },
    } as never);
    await expect(autorizar()).rejects.toThrow(/información fiscal.*regenerarse/);
    expect(periodo.estado).toBe("Generada");
  });

  it("cambio de antecedentes a CON_ANTECEDENTES con montos también bloquea autorizar", async () => {
    await generar();
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({
      ultima: null, revisiones: [],
      confirmada: {
        ...antecedenteSinAntecedentes().confirmada,
        revision: 2,
        ingresosGravadosPrevios: "1000.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00",
        datos: { ...antecedenteSinAntecedentes().confirmada.datos, declaracionAntecedentes: "CON_ANTECEDENTES" },
      },
    } as never);
    await expect(autorizar()).rejects.toThrow(/información fiscal.*regenerarse/);
  });

  it("si al autorizar ya no hay antecedente confirmado, bloquea igual (no autoriza con fiscal indeterminado)", async () => {
    await generar();
    vi.mocked(leerAntecedentesFiscalesTx).mockResolvedValue({ ultima: null, confirmada: null, revisiones: [] } as never);
    await expect(autorizar()).rejects.toThrow(/antecedentes fiscales/);
    expect(periodo.estado).toBe("Generada");
  });
});

describe("aislamiento por empresa", () => {
  it("21. una empresa no puede generar ni autorizar el período de otra (fuente de antecedentes/acumulados también aislada)", async () => {
    await expect(generarLineasPeriodo(99, 1, { usuario: "prueba" })).rejects.toThrow("Periodo no encontrado");
    await expect(autorizarPeriodoPlanilla(99, 1, "prueba")).rejects.toThrow("Periodo no encontrado");
  });

  it("22. generar/autorizar bloquean TODOS los períodos de la empresa antes de leer fiscal (mismo lock ya existente)", async () => {
    await generar();
    expect(conn.query.mock.calls[0]).toEqual([expect.stringContaining("SELECT id, estado FROM rrhh_planilla_periodos"), [3]]);
    const indiceLockGenerar = conn.query.mock.calls.findIndex(([sql]) => String(sql).includes("SELECT id, estado FROM"));
    const indiceFiscal = conn.query.mock.calls.findIndex(([sql]) => String(sql).includes("p.autorizado_en IS NOT NULL"));
    expect(indiceLockGenerar).toBeLessThan(indiceFiscal);
  });
});

describe("ISR se cobra UNA SOLA VEZ AL MES, no repartido entre quincenas (corrección de regla de negocio)", () => {
  it("1. QUINCENA_1 2026: ISR aplicado = 0, snapshot isrAplicadoPeriodo = '0.00'", async () => {
    sueldo = 30000; // suficientemente alto para que, si se cobrara, sería > 0 — prueba que NO se cobra
    periodo.tipo_periodo = "QUINCENA_1"; periodo.mes = 9;
    await generar();
    expect(Number(lineas[0].isr)).toBe(0);
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    expect(s.fiscal!.isrAplicadoPeriodo).toBe("0.00");
    // El motor SÍ calculó un mensual teórico (> 0) — solo no se aplicó en Q1.
    expect(Number((s.fiscal!.resultado as { retencionSugerida: string }).retencionSugerida)).toBeGreaterThan(0);
  });

  it("2/4. QUINCENA_2 con Q1 autorizada: Q1 entra a acumulados (ingresos/IGSS) pero NO aporta ISR; Q2 cobra el ISR completo del mes; Q1+Q2 = una sola retención, nunca doble", async () => {
    sueldo = 30000;
    periodo.tipo_periodo = "QUINCENA_1"; periodo.mes = 9;
    await generar();
    const s1 = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    const isrMensualTeoricoQ1 = Number((s1.fiscal!.resultado as { retencionSugerida: string }).retencionSugerida);
    const isrQ1 = Number(lineas[0].isr);
    expect(isrQ1).toBe(0); // Q1 nunca cobra ISR

    // Simula que Q1 quedó autorizada: disponible como acumulado para el
    // adapter (prioridades) y para la reconciliación de sueldo/IGSS ya
    // existente en planillas.ts (q1Datos) — dos consultas SQL distintas.
    const q1Linea = { ...lineas[0] };
    prioridades = [{
      sueldo_base: Number(q1Linea.sueldo_base), bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0,
      igss_laboral: Number(q1Linea.igss_laboral), isr: isrQ1, // 0, no aporta ISR retenido
      conceptos_snapshot: q1Linea.conceptos_snapshot, mes_periodo: 9, anio_periodo: 2026,
    }];
    q1Datos = [{ id_empleado: 7, sueldo_base: q1Linea.sueldo_base, bono_incentivo: q1Linea.bono_incentivo,
      bono_herramientas: q1Linea.bono_herramientas, igss_laboral: q1Linea.igss_laboral, igss_patronal: q1Linea.igss_patronal, isr: isrQ1 }];
    lineas = []; // QUINCENA_2 es un período nuevo, sin línea propia todavía

    periodo.tipo_periodo = "QUINCENA_2";
    await generar();
    const s2 = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    const input2 = s2.fiscal!.inputUsado as { ingresosPropiosAcumulados: { monto: string }[]; isrRetenidoPropioQ: string };
    // Q1 SÍ entra en ingresos acumulados (sueldo, IGSS)...
    expect(input2.ingresosPropiosAcumulados[0].monto).toBe(Number(q1Linea.sueldo_base).toFixed(2));
    // ...pero NO aporta ISR retenido (Q1 siempre fue 0).
    expect(input2.isrRetenidoPropioQ).toBe("0.00");

    const isrMensualTeoricoQ2 = Number((s2.fiscal!.resultado as { retencionSugerida: string }).retencionSugerida);
    const isrQ2 = Number(lineas[0].isr);
    // Nada cambió entre Q1 y Q2 (mismo sueldo total del mes, sin acumulados
    // de OTROS meses): el "mensual teórico" que ve el motor es el MISMO en
    // ambos casos — Q2 cobra ese valor COMPLETO, sin restar nada de Q1.
    expect(isrMensualTeoricoQ2).toBeCloseTo(isrMensualTeoricoQ1, 2);
    expect(isrQ2).toBeCloseTo(isrMensualTeoricoQ2, 2);
    expect(isrQ2).toBeGreaterThan(0);
    const s2fiscal = s2.fiscal!.isrAplicadoPeriodo;
    expect(Number(s2fiscal)).toBeCloseTo(isrQ2, 2);
    // 4. Q1 + Q2 = una sola retención mensual, nunca "mitad + mitad" ni doble descuento.
    expect(isrQ1 + isrQ2).toBeCloseTo(isrMensualTeoricoQ1, 2);
  });

  it("3. MENSUAL: cobra todo el ISR correspondiente al mes", async () => {
    sueldo = 30000;
    periodo.tipo_periodo = "MENSUAL"; periodo.mes = 9;
    await generar();
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    const isrMensualTeorico = Number((s.fiscal!.resultado as { retencionSugerida: string }).retencionSugerida);
    expect(Number(lineas[0].isr)).toBeCloseTo(isrMensualTeorico, 2);
    expect(Number(lineas[0].isr)).toBeGreaterThan(0);
    expect(s.fiscal!.isrAplicadoPeriodo).toBe(isrMensualTeorico.toFixed(2));
  });
});

describe("parametrosRevision se revalida realmente al autorizar (corrección #2, segunda ronda)", () => {
  it("un cambio de parametrosRevision entre generar y autorizar bloquea, aunque el input fiscal siga igual", async () => {
    await generar();
    const real = fiscalIsr2026.calcularIsrTrabajo2026;
    const spy = vi.spyOn(fiscalIsr2026, "calcularIsrTrabajo2026").mockImplementation((input) => {
      const r = real(input);
      return { ...r, parametrosRevision: { ...r.parametrosRevision, version: "2026.2-simulada" } };
    });
    try {
      await expect(autorizar()).rejects.toThrow(/información fiscal.*regenerarse/);
      expect(periodo.estado).toBe("Generada");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("auditoría de override manual sin falsos positivos en quincenas (corrección #3, segunda ronda)", () => {
  function detalleAuditoria(): Record<string, unknown> {
    const llamada = vi.mocked(registrarAuditoriaTx).mock.calls.find(
      ([, args]) => (args as { accion?: string }).accion === "autorizar_periodo_planilla",
    );
    return JSON.parse(String((llamada?.[1] as { detalle: string }).detalle));
  }

  it("1. MENSUAL automático -> no marcado como override", async () => {
    periodo.tipo_periodo = "MENSUAL";
    await generar();
    await autorizar();
    expect(detalleAuditoria().isrSobrescritoManualmente).toBeUndefined();
  });

  it("2. QUINCENA_1 automática -> no marcado como override", async () => {
    periodo.tipo_periodo = "QUINCENA_1";
    await generar();
    await autorizar();
    expect(detalleAuditoria().isrSobrescritoManualmente).toBeUndefined();
  });

  it("3. QUINCENA_2 automática (con Q1 autorizada) -> no marcado como override", async () => {
    sueldo = 30000;
    periodo.tipo_periodo = "QUINCENA_1"; periodo.mes = 9;
    await generar();
    const isrQ1 = Number(lineas[0].isr);
    const q1Linea = { ...lineas[0] };
    prioridades = [{ sueldo_base: Number(q1Linea.sueldo_base), bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0,
      igss_laboral: Number(q1Linea.igss_laboral), isr: isrQ1, conceptos_snapshot: q1Linea.conceptos_snapshot, mes_periodo: 9, anio_periodo: 2026 }];
    q1Datos = [{ id_empleado: 7, sueldo_base: q1Linea.sueldo_base, bono_incentivo: q1Linea.bono_incentivo,
      bono_herramientas: q1Linea.bono_herramientas, igss_laboral: q1Linea.igss_laboral, igss_patronal: q1Linea.igss_patronal, isr: isrQ1 }];
    lineas = [];
    periodo.tipo_periodo = "QUINCENA_2";
    await generar();
    await autorizar();
    expect(detalleAuditoria().isrSobrescritoManualmente).toBeUndefined();
  });

  it("4. ISR editado manualmente antes de autorizar -> sí marcado como override", async () => {
    await generar();
    const linea = lineas[0];
    const nuevoIsr = Number(linea.isr) + 50; // simula un ajuste manual vía actualizarLinea()
    linea.isr = nuevoIsr;
    linea.neto = redondearQ(
      Number(linea.sueldo_base) + Number(linea.bono_incentivo) + Number(linea.bono_herramientas) + Number(linea.otros_ingresos)
      - Number(linea.igss_laboral) - Number(linea.descuentos) - nuevoIsr,
    );
    await autorizar();
    expect(detalleAuditoria().isrSobrescritoManualmente).toEqual([7]);
  });
});

describe("configuración fiscal versionada de conceptos (RRHH-FISCAL-CONCEPTOS-2026)", () => {
  it("14. la revisión de configuración de conceptos usada queda congelada en el snapshot", async () => {
    await generar();
    const s = leerConceptosSnapshot(lineas[0].conceptos_snapshot)!;
    expect(s.fiscal!.configuracionConceptosRevision).toBe("2026.r1");
  });

  it("15. un cambio de revisión de configuración entre generar y autorizar bloquea, aunque el input fiscal siga igual", async () => {
    await generar();
    const spy = vi
      .spyOn(fiscalConceptos2026, "CONFIGURACION_CONCEPTOS_2026_REVISION", "get")
      .mockReturnValue("2026.r2-simulada" as never);
    try {
      await expect(autorizar()).rejects.toThrow(/información fiscal.*regenerarse/);
      expect(periodo.estado).toBe("Generada");
    } finally {
      spy.mockRestore();
    }
  });

  it("16. no hay fuzzy matching por texto: una prestación con texto 'Aguinaldo' sigue bloqueando como PENDIENTE, no se resuelve por coincidencia de nombre", async () => {
    conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.includes("p.autorizado_en IS NOT NULL")) return [prioridades, []];
      if (sql.includes("INNER JOIN rrhh_planilla_lineas")) return [q1Datos, []];
      if (sql.includes("FROM empleados")) return [Number(params[0]) === 3 && params.slice(1).includes(7) ? [{ id: 7, codigo: "E7", sueldo_base: sueldo, bono_incentivo: bonoIncentivo, bono_herramientas: 0 }] : [], []];
      if (sql.includes("SELECT id, estado FROM")) return [Number(params[0]) === 3 ? [periodo] : [], []];
      if (sql.includes("SELECT q2.id")) return [[], []];
      if (sql.includes("SELECT autorizado_en") || sql.includes("SELECT * FROM rrhh_planilla_periodos")) return [[periodo], []];
      if (sql.includes("FROM rrhh_planilla_lineas")) return [lineas, []];
      if (sql.includes("FROM rrhh_descuentos_maestro")) return [[], []];
      if (sql.includes("FROM rrhh_descuento_cuotas")) return [[], []];
      if (sql.includes("FROM rrhh_descuento_abonos")) return [[], []];
      if (sql.includes("FROM horas_extra_registros")) return [[], []];
      if (sql.includes("FROM rrhh_descuentos")) return [[], []];
      // Texto libre exacto "Aguinaldo" — aunque la configuración 2026 SÍ
      // clasifica el código AGUINALDO (CONDICIONAL con límite), esta fila NO
      // trae ese código: solo texto libre sin origen estable.
      if (sql.includes("FROM rrhh_prestaciones")) return [[{ id: 90, empresa_id: 3, id_empleado: 7, concepto: "Aguinaldo", fecha: "2026-09-01", monto: 3000 }], []];
      return [[], []];
    });
    await expect(generar()).rejects.toThrow(/Prestación "Aguinaldo".*PENDIENTE|no tiene clasificación fiscal 2026/);
  });
});

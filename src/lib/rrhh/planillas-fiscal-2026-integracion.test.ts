import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("./isr", () => ({ calcularISRMensual: () => 999 })); // testigo: si esto se usa en 2026, los tests fallarían.
vi.mock("./fiscal-antecedentes", () => ({ leerAntecedentesFiscales: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { leerAntecedentesFiscales } from "./fiscal-antecedentes";
import { generarLineasPeriodo, autorizarPeriodoPlanilla } from "./planillas";
import { leerConceptosSnapshot } from "./planilla-conceptos";

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
let prioridades: Row[]; // líneas de períodos previos ya autorizados del ejercicio
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
  sueldo = 4000; bonoIncentivo = 0; lineas = []; prioridades = [];
  periodo = { id: 1, empresa_id: 3, codigo: "PRUEBA", estado: "Borrador", autorizado_en: null, autorizado_por: null,
    fecha_inicio: "2026-09-01", fecha_fin: "2026-09-30", tipo_periodo: "MENSUAL", mes: 9, anio: 2026 };
  vi.mocked(leerAntecedentesFiscales).mockResolvedValue(antecedenteSinAntecedentes() as never);
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
    expect(leerAntecedentesFiscales).not.toHaveBeenCalled();
  });
});

describe("acumulados, proyección y no duplicación", () => {
  it("3/9. acumulados de un período 2026 ya autorizado se incorporan al calcular el actual", async () => {
    prioridades = [{ sueldo_base: 4000, bono_incentivo: 0, bono_herramientas: 0, otros_ingresos: 0, igss_laboral: 193.2, isr: 150 }];
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
    vi.mocked(leerAntecedentesFiscales).mockClear();
    await expect(autorizar()).rejects.toThrow("ya está autorizada");
    expect(lineas[0].isr).toBe(isrCongelado);
    expect(leerAntecedentesFiscales).not.toHaveBeenCalled();
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
    vi.mocked(leerAntecedentesFiscales).mockResolvedValue({
      ultima: null, revisiones: [],
      confirmada: { ...antecedenteSinAntecedentes().confirmada, revision: 2, ingresosGravadosPrevios: null },
    } as never);
    await expect(autorizar()).rejects.toThrow(/información fiscal.*regenerarse/);
    expect(periodo.estado).toBe("Generada");
  });

  it("cambio de antecedentes a CON_ANTECEDENTES con montos también bloquea autorizar", async () => {
    await generar();
    vi.mocked(leerAntecedentesFiscales).mockResolvedValue({
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
    vi.mocked(leerAntecedentesFiscales).mockResolvedValue({ ultima: null, confirmada: null, revisiones: [] } as never);
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

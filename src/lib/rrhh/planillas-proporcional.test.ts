import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RRHH PLANILLAS — generación con pago PROPORCIONAL por ingreso/egreso (bono incentivo, IGSS, snapshot, inclusión de
 * bajas). Sin BD real: el pool está simulado y ejecuta el SQL real de generarLineasPeriodo. Períodos 2025 → ISR con
 * isr.ts (mockeado a Q100/mes) para aislar aquí el devengo; el ISR 2026 se prueba en planilla-fiscal-2026-proporcional.test.ts.
 */
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("./planilla-conceptos", async (original) => ({ ...await original<typeof import("./planilla-conceptos")>(), obtenerConceptosPendientes: vi.fn(), aplicarConceptosSnapshot: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/rrhh/isr", () => ({ calcularISRMensual: () => 100 }));

import { getPool, query } from "@/lib/db";
import { obtenerConceptosPendientes } from "./planilla-conceptos";
import { generarLineasPeriodo } from "./planillas";

const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
type Fila = Record<string, unknown>;
const Q1 = { fecha_inicio: "2025-09-01", fecha_fin: "2025-09-15", tipo_periodo: "QUINCENA_1" };
const Q2 = { fecha_inicio: "2025-09-16", fecha_fin: "2025-09-30", tipo_periodo: "QUINCENA_2" };
let periodo: Fila;
let empleados: Fila[];
let q1Rows: Fila[];
let insertadas: Fila[];
let sqlEmpleados: string;

const emp = (id: number, over: Fila = {}): Fila => ({
  id, codigo: `E${id}`, nombre: `Empleado ${id}`, dpi: null, tipo_contrato: "fijo", forma_pago: "transferencia", estado: "Activo",
  sueldo_base: 6000, bono_incentivo: 250, bono_herramientas: 0, fecha_alta: "2020-01-01", fecha_inicio_laboral: null, fecha_egreso: null, ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  periodo = { id: 1, codigo: "P", estado: "Generada", mes: 9, anio: 2025, ...Q1 };
  empleados = []; q1Rows = []; insertadas = [];
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as never);
  vi.mocked(query).mockImplementation((async (sql: string) => {
    if (sql.includes("FROM rrhh_planilla_periodos")) return [periodo];
    if (sql.includes("FROM empleados")) { sqlEmpleados = sql; return empleados; }
    return [];
  }) as never);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id, estado FROM rrhh_planilla_periodos")) return [[{ id: 1, estado: "Generada" }], []];
    if (sql.includes("SELECT autorizado_en")) return [[{ autorizado_en: null }], []];
    if (sql.includes("SELECT * FROM rrhh_planilla_periodos")) return [[periodo], []];
    if (sql.includes("SELECT q2.id")) return [[], []];
    if (sql.includes("INNER JOIN rrhh_planilla_lineas")) return [q1Rows, []];
    return [[], []];
  });
  conn.execute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("INSERT INTO rrhh_planilla_lineas")) {
      const keys = ["empresa_id", "periodo_id", "id_empleado", "codigo_empleado", "nombre_empleado", "dpi", "tipo_contrato", "forma_pago", "sueldo_base", "bono_incentivo", "bono_herramientas", "otros_ingresos", "igss_laboral", "igss_patronal", "descuentos", "isr", "neto", "estado_pago", "ref_pago", "conceptos_snapshot"];
      insertadas.push(Object.fromEntries(keys.map((k, i) => [k, params[i]])));
    }
    return [{ affectedRows: 1 }, []];
  });
  vi.mocked(obtenerConceptosPendientes).mockResolvedValue(new Map());
});

const generar = () => generarLineasPeriodo(3, 1, { usuario: "prueba" });
const linea = (id: number) => insertadas.find((l) => l.id_empleado === id)!;
const snap = (id: number) => JSON.parse(String(linea(id).conceptos_snapshot));
/** Genera Q1 y luego Q2 usando la línea persistida de Q1 como base de conciliación (como en producción). */
async function mes(e: Fila) {
  empleados = [e];
  periodo = { ...periodo, ...Q1 };
  await generar();
  const l1 = { ...linea(Number(e.id)) };
  q1Rows = [{ id_empleado: e.id, sueldo_base: l1.sueldo_base, bono_incentivo: l1.bono_incentivo, bono_herramientas: l1.bono_herramientas, igss_laboral: l1.igss_laboral, igss_patronal: l1.igss_patronal, isr: l1.isr }];
  periodo = { ...periodo, ...Q2 };
  insertadas = [];
  await generar();
  return { q1: l1, q2: { ...linea(Number(e.id)) } };
}

describe("Inclusión en la planilla por relación laboral", () => {
  it("consulta Activos Y Bajas (no solo estado = 'Activo') y trae las fechas laborales", async () => {
    empleados = [emp(1)];
    await generar();
    expect(sqlEmpleados).toContain("estado IN ('Activo', 'Baja')");
    for (const c of ["fecha_alta", "fecha_inicio_laboral", "fecha_egreso"]) expect(sqlEmpleados).toContain(c);
  });

  it("estado Baja con egreso el 03/09 SÍ aparece en Q1 con 3 días (Q600) y NO en Q2", async () => {
    empleados = [emp(1, { estado: "Baja", fecha_egreso: "2025-09-03" })];
    await generar();
    expect(linea(1)).toMatchObject({ sueldo_base: 600 });
    expect(snap(1).devengo).toMatchObject({ diasDevengados: 3, fechaEgreso: "2025-09-03", estadoEmpleado: "Baja" });
    insertadas = []; periodo = { ...periodo, ...Q2 };
    await generar();
    expect(insertadas).toHaveLength(0);
  });

  it("ingreso el 20/09: no aparece en Q1; en Q2 cobra solo desde el 20 (11 días = Q2,200)", async () => {
    empleados = [emp(1, { fecha_alta: "2025-09-20" })];
    await generar();
    expect(insertadas).toHaveLength(0);
    periodo = { ...periodo, ...Q2 };
    await generar();
    expect(linea(1)).toMatchObject({ sueldo_base: 2200 });
  });

  it("baja antes del período o ingreso posterior: excluidos; Baja sin fecha de egreso: excluida", async () => {
    empleados = [emp(1, { estado: "Baja", fecha_egreso: "2025-08-31" }), emp(2, { fecha_alta: "2025-09-20" }), emp(3, { estado: "Baja", fecha_egreso: null }), emp(4)];
    await generar();
    expect(insertadas.map((l) => l.id_empleado)).toEqual([4]);
  });

  it("se usa la fecha de entrada laboral y, si no existe, la de contratación", async () => {
    empleados = [emp(1, { fecha_alta: "2020-01-01", fecha_inicio_laboral: "2025-09-07" }), emp(2, { fecha_alta: "2025-09-07", fecha_inicio_laboral: null })];
    await generar();
    expect(linea(1).sueldo_base).toBe(1800);
    expect(linea(2).sueldo_base).toBe(1800);
  });

  it("período ESPECIAL: solo Activos y valor mensual completo (regla anterior)", async () => {
    periodo = { ...periodo, tipo_periodo: "ESPECIAL" };
    empleados = [emp(1, { estado: "Baja", fecha_egreso: "2025-09-03" }), emp(2, { fecha_alta: "2025-09-07" })];
    await generar();
    expect(insertadas.map((l) => l.id_empleado)).toEqual([2]);
    expect(linea(2).sueldo_base).toBe(6000);
  });
});

describe("BONIFICACIÓN INCENTIVO proporcional", () => {
  it("17) Q250 completa → Q125 en una Q1 normal", async () => {
    empleados = [emp(1)];
    await generar();
    expect(linea(1)).toMatchObject({ sueldo_base: 3000, bono_incentivo: 125 });
  });
  it("18) ingreso el 14/09 (2 días): 250 / 30 × 2 = Q16.67, no Q125", async () => {
    empleados = [emp(1, { fecha_alta: "2025-09-14" })];
    await generar();
    expect(linea(1)).toMatchObject({ sueldo_base: 400, bono_incentivo: 16.67 });
    expect(snap(1).devengo).toMatchObject({ diasDevengados: 2, bonoIncentivoMensual: 250, bonoIncentivoPeriodo: 16.67 });
  });
  it("19) baja el día 3: proporcional (Q25)", async () => {
    empleados = [emp(1, { estado: "Baja", fecha_egreso: "2025-09-03" })];
    await generar();
    expect(linea(1).bono_incentivo).toBe(25);
  });
  it("20) bono contractual distinto de Q250 (Q400): completa Q200; con 9 días Q120", async () => {
    empleados = [emp(1, { bono_incentivo: 400 })];
    await generar();
    expect(linea(1).bono_incentivo).toBe(200);
    empleados = [emp(2, { bono_incentivo: 400, fecha_alta: "2025-09-07" })];
    insertadas = [];
    await generar();
    expect(linea(2).bono_incentivo).toBe(120);
  });
  it("bono en NULL usa Q250 por defecto (formal) y Q0 en outsourcing, como siempre", async () => {
    empleados = [emp(1, { bono_incentivo: null }), emp(2, { bono_incentivo: null, tipo_contrato: "outsourcing" })];
    await generar();
    expect([linea(1).bono_incentivo, linea(2).bono_incentivo]).toEqual([125, 0]);
  });
  it("bono herramientas (importe mensual fijo contractual) se prorratea igual que el bono incentivo", async () => {
    empleados = [emp(1, { bono_herramientas: 300, fecha_alta: "2025-09-07" })];
    await generar();
    expect(linea(1).bono_herramientas).toBe(90); // 300 / 30 × 9
  });
  it("Q1 + Q2 del bono con ingreso el día 7 = 250 × 24 / 30 = Q200 (Q75 + Q125)", async () => {
    const { q1, q2 } = await mes(emp(1, { fecha_alta: "2025-09-07" }));
    expect([q1.bono_incentivo, q2.bono_incentivo]).toEqual([75, 125]);
  });
});

describe("IGSS sobre el sueldo realmente devengado", () => {
  const PCT = 0.0483;
  it("21) ingreso parcial: la base es el sueldo proporcional (Q1,800 × 4.83% = Q86.94)", async () => {
    empleados = [emp(1, { fecha_alta: "2025-09-07" })];
    await generar();
    expect(linea(1).igss_laboral).toBe(86.94);
    expect(linea(1).igss_patronal).toBe(228.06); // 1,800 × 12.67%
  });
  it("22) baja parcial: base proporcional (Q600 × 4.83% = Q28.98); la bonificación NO paga IGSS", async () => {
    empleados = [emp(1, { estado: "Baja", fecha_egreso: "2025-09-03" })];
    await generar();
    expect(linea(1).igss_laboral).toBe(28.98);
    expect(linea(1).igss_laboral).toBeCloseTo(600 * PCT, 2); // sin sumar los Q25 del bono
  });
  it("23) Q1 + Q2 cuadra con el mes REAL devengado (24 días → Q231.84), no con el sueldo completo", async () => {
    const { q1, q2 } = await mes(emp(1, { fecha_alta: "2025-09-07" }));
    expect(Math.round(((q1.igss_laboral as number) + (q2.igss_laboral as number)) * 100) / 100).toBe(231.84);
    expect(Math.round(((q1.igss_patronal as number) + (q2.igss_patronal as number)) * 100) / 100).toBe(608.16);
  });
  it("23b) empleado de mes completo: Q1 + Q2 = IGSS mensual exacto (sin regresión)", async () => {
    const { q1, q2 } = await mes(emp(1));
    expect(Math.round(((q1.igss_laboral as number) + (q2.igss_laboral as number)) * 100) / 100).toBe(289.8);
    expect([q1.sueldo_base, q2.sueldo_base]).toEqual([3000, 3000]);
  });
  it("24) outsourcing mantiene sus reglas: sin IGSS ni ISR; el sueldo sí es proporcional", async () => {
    empleados = [emp(1, { tipo_contrato: "outsourcing", bono_incentivo: 0, fecha_alta: "2025-09-07" })];
    await generar();
    expect(linea(1)).toMatchObject({ sueldo_base: 1800, igss_laboral: 0, igss_patronal: 0, isr: 0 });
  });
});

describe("Snapshot del devengo y regresión", () => {
  it("conceptos_snapshot.devengo explica el cálculo (por qué Q1,800 y no Q3,000)", async () => {
    empleados = [emp(1, { fecha_alta: "2025-09-07" })];
    await generar();
    expect(snap(1).devengo).toEqual({
      estadoEmpleado: "Activo", fechaInicioLaboral: "2025-09-07", fechaEgreso: null, inicioDevengo: "2025-09-07", finDevengo: "2025-09-15",
      diasPeriodoNominales: 15, diasDevengados: 9, baseDiasMensual: 30, prorrateado: true, sueldoMensual: 6000, salarioDiario: 200,
      sueldoPeriodo: 1800, bonoIncentivoMensual: 250, bonoIncentivoPeriodo: 75, bonoHerramientasMensual: 0, bonoHerramientasPeriodo: 0,
    });
  });
  it("44) empleado activo todo el mes: mismos importes de siempre (Q1 = mitad, Q1 + Q2 = mensual)", async () => {
    const { q1, q2 } = await mes(emp(1, { sueldo_base: 4000 }));
    expect([q1.sueldo_base, q2.sueldo_base, q1.bono_incentivo, q2.bono_incentivo]).toEqual([2000, 2000, 125, 125]);
    expect(Math.round(((q1.igss_laboral as number) + (q2.igss_laboral as number)) * 100) / 100).toBe(193.2);
    expect(snap(1).devengo).toMatchObject({ diasDevengados: 15, prorrateado: true });
  });
  it("Q2 generada ANTES que Q1 (sin Q1 persistida) cobra solo lo devengado en Q2, no el mensual completo", async () => {
    empleados = [emp(1)];
    periodo = { ...periodo, ...Q2 };
    const r = await generar();
    expect(linea(1).sueldo_base).toBe(3000);
    expect(r.empleadosSinIgssQ1).toBe(1);
  });
  it("neto = ingresos proporcionales − IGSS − descuentos − ISR", async () => {
    empleados = [emp(1, { fecha_alta: "2025-09-07" })];
    await generar();
    expect(linea(1).neto).toBe(Math.round((1800 + 75 - 86.94 - 50) * 100) / 100); // isr Q1 = 100/2 (ejercicio sin motor propio)
  });
  it("no se toca la generación de un mes completo por ingreso ANTERIOR al período", async () => {
    empleados = [emp(1, { fecha_alta: "2025-08-20" })];
    await generar();
    expect(linea(1)).toMatchObject({ sueldo_base: 3000, bono_incentivo: 125 });
  });
});

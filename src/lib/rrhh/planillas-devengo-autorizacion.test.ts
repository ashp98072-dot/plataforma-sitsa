import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RRHH PLANILLAS — al AUTORIZAR se revalida el DEVENGO con la relación laboral ACTUAL (estado, fecha entrada/contratación,
 * egreso, sueldo y bonos), para toda línea con `conceptos_snapshot.devengo` (formal u outsourcing, cualquier ejercicio, con
 * o sin snapshot fiscal). No depende del motor de ISR. Sin BD real: pool simulado que ejecuta el SQL real de generar/autorizar.
 */
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("./isr", () => ({ calcularISRMensual: () => 100 }));
vi.mock("./planilla-conceptos", async (original) => ({
  ...await original<typeof import("./planilla-conceptos")>(),
  obtenerConceptosPendientes: vi.fn(async () => new Map()),
  aplicarConceptosSnapshot: vi.fn(),
}));

import { getPool, query } from "@/lib/db";
import { autorizarPeriodoPlanilla, generarLineasPeriodo } from "./planillas";
import { MSG_DEVENGO_CAMBIO } from "./planilla-devengo";

type Row = Record<string, unknown>;
let periodo: Row;
let lineas: Row[];
let emp: Row;
const conn = { beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), query: vi.fn(), execute: vi.fn() };
const generar = () => generarLineasPeriodo(3, 1, { usuario: "prueba" });
const autorizar = () => autorizarPeriodoPlanilla(3, 1, "gerente");

beforeEach(() => {
  vi.resetAllMocks();
  periodo = { id: 1, empresa_id: 3, codigo: "P", estado: "Borrador", autorizado_en: null, autorizado_por: null, fecha_inicio: "2025-09-01", fecha_fin: "2025-09-15", tipo_periodo: "QUINCENA_1", mes: 9, anio: 2025 };
  lineas = [];
  emp = { id: 7, codigo: "E7", nombre: "Empleado", dpi: null, tipo_contrato: "fijo", forma_pago: "transferencia", estado: "Activo", sueldo_base: 6000, bono_incentivo: 250, bono_herramientas: 0, fecha_alta: "2020-01-01", fecha_inicio_laboral: "2025-09-07", fecha_egreso: null };
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as never);
  vi.mocked(query).mockImplementation((async (sql: string) => {
    if (sql.includes("FROM rrhh_planilla_periodos")) return [periodo];
    if (sql.includes("FROM empleados")) return [emp];
    return [];
  }) as never);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM empleados")) return [[emp], []];
    if (sql.includes("SELECT id, estado FROM")) return [[periodo], []];
    if (sql.includes("SELECT q2.id")) return [[], []];
    if (sql.includes("SELECT autorizado_en") || sql.includes("SELECT * FROM rrhh_planilla_periodos")) return [[periodo], []];
    if (sql.includes("FROM rrhh_planilla_lineas")) return [lineas, []];
    return [[], []];
  });
  conn.execute.mockImplementation(async (sql: string, p: unknown[]) => {
    if (sql.includes("INSERT INTO rrhh_planilla_lineas")) {
      const keys = ["empresa_id", "periodo_id", "id_empleado", "codigo_empleado", "nombre_empleado", "dpi", "tipo_contrato", "forma_pago", "sueldo_base", "bono_incentivo", "bono_herramientas", "otros_ingresos", "igss_laboral", "igss_patronal", "descuentos", "isr", "neto", "estado_pago", "ref_pago", "conceptos_snapshot"];
      lineas = [{ ...Object.fromEntries(keys.map((k, i) => [k, p[i]])), id: 100 }];
    } else if (sql.includes("UPDATE rrhh_planilla_periodos")) {
      if (sql.includes("autorizado_en = NOW()")) { periodo.estado = "Cerrada"; periodo.autorizado_en = "2025-09-16 12:00:00"; } else periodo.estado = "Generada";
    }
    return [{ affectedRows: 1 }, []];
  });
});

const sinAutorizar = async () => {
  expect(periodo.autorizado_en).toBeNull();
  expect(periodo.estado).toBe("Generada");
};

describe("autorizar revalida el devengo contra la relación laboral actual", () => {
  it("5) sin cambios: autoriza normalmente (ingreso a mitad de período, sueldo proporcional Q1,800)", async () => {
    await generar();
    expect(lineas[0].sueldo_base).toBe(1800);
    await autorizar();
    expect(periodo.estado).toBe("Cerrada");
    expect(periodo.autorizado_en).not.toBeNull();
  });

  it("1) cambia fecha_inicio_laboral después de generar → autorizar bloquea", async () => {
    await generar();
    emp.fecha_inicio_laboral = "2025-09-01"; // ahora habría trabajado todo Q1
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
    await sinAutorizar();
  });

  it("1b) el fallback fecha_alta también cuenta: quitar la fecha de entrada laboral cambia el devengo", async () => {
    await generar();
    emp.fecha_inicio_laboral = null; // cae a fecha_alta 2020-01-01
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
  });

  it("2) cambia fecha_egreso → bloquea (incluso si el estado sigue Activo)", async () => {
    await generar();
    emp.fecha_egreso = "2025-09-10";
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
    await sinAutorizar();
  });

  it("3) Activo pasa a Baja con egreso distinto → bloquea", async () => {
    emp.fecha_inicio_laboral = null; // empleado de todo el período
    await generar();
    emp.estado = "Baja"; emp.fecha_egreso = "2025-09-03";
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
    await sinAutorizar();
  });

  it("3b) solo cambia el estado (Activo → Baja) sin cambiar fechas: también bloquea", async () => {
    await generar();
    emp.estado = "Baja";
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
  });

  it("4) outsourcing con cambio de fecha → bloquea (no depende del motor ISR)", async () => {
    emp.tipo_contrato = "outsourcing";
    await generar();
    expect(lineas[0]).toMatchObject({ sueldo_base: 1800, igss_laboral: 0, isr: 0 });
    emp.fecha_inicio_laboral = "2025-09-10";
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
    await sinAutorizar();
  });

  it("outsourcing sin cambios autoriza (el default de bono Q0 coincide al generar y al autorizar)", async () => {
    emp.tipo_contrato = "outsourcing"; emp.bono_incentivo = null;
    await generar();
    await expect(autorizar()).resolves.toBeUndefined();
  });

  it("cambia el sueldo o el bono contractual después de generar → bloquea (por devengo, con o sin fechas)", async () => {
    await generar();
    emp.bono_incentivo = 300;
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
  });

  it("un ejercicio distinto de 2026 (sin snapshot fiscal) también se revalida", async () => {
    await generar();
    const snap = JSON.parse(String(lineas[0].conceptos_snapshot));
    expect(snap.fiscal).toBeUndefined();
    expect(snap.devengo).toBeDefined();
    emp.fecha_egreso = "2025-09-12";
    await expect(autorizar()).rejects.toThrow(MSG_DEVENGO_CAMBIO);
  });

  it("líneas antiguas SIN devengo en el snapshot no se ven afectadas (compatibilidad)", async () => {
    await generar();
    const snap = JSON.parse(String(lineas[0].conceptos_snapshot));
    delete snap.devengo;
    lineas[0].conceptos_snapshot = JSON.stringify(snap);
    emp.fecha_egreso = "2025-09-12"; // sin devengo guardado no hay contra qué comparar
    await expect(autorizar()).resolves.toBeUndefined();
  });

  it("la revalidación usa la MISMA función que la generación (sin lógica duplicada)", () => {
    const fuente = readFileSync("src/lib/rrhh/planillas.ts", "utf8");
    expect(fuente.match(/construirDevengoSnapshot\(/g)).toHaveLength(2);
    expect(fuente).toContain("camposDevengoCambiados(s.devengo, recalculado)");
    expect(fuente).toContain("MSG_DEVENGO_CAMBIO");
  });
});

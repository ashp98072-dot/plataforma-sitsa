import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorImportacionFiscal, importarAcumuladosFiscales, capturarAntecedentesFiscales, confirmarAntecedentesFiscales } from "./fiscal-antecedentes";
import type { AntecedenteFiscal } from "./fiscal-modelo";

/**
 * IMPORTACIÓN MASIVA — atomicidad. BD en memoria TRANSACCIONAL (BEGIN respalda; ROLLBACK restaura filas y auditoría) que
 * responde al SQL real de fiscal-antecedentes.ts. Reloj fijo 2026-10-05. Sin BD real.
 */
type Fila = Record<string, unknown>;
const conn = { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const h = { fallaEnInsert: 0, solape: new Set<number>() };
let filas: Fila[];
let auditoria: { accion: string; detalle: string; usuario: string }[];
let respaldo = "";
let inserts = 0;
let eventos: string[];

const migracion = (): AntecedenteFiscal => ({
  inicioFiscal: "2026-01-01", corteAntecedentes: "2026-03-31",
  ingresosGravadosPrevios: "45000.00", ingresosExentosPrevios: "2000.00", igssLaboralPrevio: "2173.50", isrRetenidoPrevio: "1250.00",
  datos: { version: 1, declaracionAntecedentes: "ACUMULADO_INICIAL_MIGRACION", constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [],
    otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] }, migracion: { referenciaOrigen: "Sistema anterior", observacion: null, documentoId: null } },
});
const items = (n: number) => Array.from({ length: n }, (_, i) => ({ numeroFila: i + 2, empleadoId: i + 1, ejercicio: 2026, antecedente: migracion() }));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-05T18:00:00Z"));
  vi.resetAllMocks();
  filas = []; auditoria = []; inserts = 0; eventos = [];
  h.fallaEnInsert = 0; h.solape = new Set();
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  vi.mocked(registrarAuditoriaTx).mockImplementation((async (_c: unknown, i: { accion: string; detalle?: string; usuario?: string | null }) => { eventos.push("audit"); auditoria.push({ accion: i.accion, detalle: String(i.detalle), usuario: String(i.usuario) }); }) as never);
  conn.beginTransaction.mockImplementation(async () => { eventos.push("begin"); respaldo = JSON.stringify({ filas, auditoria }); });
  conn.commit.mockImplementation(async () => { eventos.push("commit"); });
  conn.rollback.mockImplementation(async () => { eventos.push("rollback"); ({ filas, auditoria } = JSON.parse(respaldo)); });
  conn.execute.mockImplementation(async (sql: string, p: unknown[] = []) => {
    if (sql.includes("information_schema")) return [["empleados", "documentos_empleados", "auditoria", "rrhh_fiscal_empleado_ejercicio"].map((TABLE_NAME) => ({ TABLE_NAME, ENGINE: "InnoDB" }))];
    if (sql.startsWith("SELECT id FROM empleados")) return [[{ id: p[1] }]];
    if (sql.includes("FROM rrhh_planilla_periodos p")) return [h.solape.has(Number(p[1])) ? [{ id: 1 }] : []];
    if (sql.includes("SELECT * FROM rrhh_fiscal_empleado_ejercicio")) return [filas.filter((r) => r.id_empleado === p[1] && r.ejercicio === p[2]).sort((a, b) => Number(b.revision) - Number(a.revision))];
    if (sql.startsWith("INSERT INTO rrhh_fiscal_empleado_ejercicio")) {
      inserts += 1;
      if (h.fallaEnInsert && inserts === h.fallaEnInsert) throw new Error("fallo inyectado en INSERT");
      filas.push({ id_empleado: p[1], ejercicio: p[2], revision: p[3], corte: p[5], confirmado_en: null, creado_por: p[11] });
      return [{ insertId: filas.length, affectedRows: 1 }];
    }
    throw new Error(`consulta inesperada: ${sql.slice(0, 60)}`);
  });
});
afterEach(() => vi.useRealTimers());

const importar = (n = 10) => importarAcumuladosFiscales(7, items(n), "rrhh.ana", "Acumulados_2026.xlsx");

describe("IMPORTACIÓN MASIVA — todo o nada", () => {
  it("37) 10 filas válidas → 10 borradores en UNA conexión y UNA transacción (no una por fila)", async () => {
    const r = await importar(10);
    expect(r.importados).toBe(10);
    expect(filas).toHaveLength(10);
    expect(conn.beginTransaction).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getPool)().getConnection).toHaveBeenCalledTimes(1);
  });
  it("36) los registros quedan SIN confirmar: no hay UPDATE ni confirmado_en (la confirmación sigue siendo individual)", async () => {
    await importar(10);
    expect(filas.every((f) => f.confirmado_en === null && f.revision === 1)).toBe(true);
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE"))).toBe(false);
  });
  it("38) si falla la fila 10 → CERO registros nuevos y CERO auditoría (rollback total)", async () => {
    h.fallaEnInsert = 10;
    await expect(importar(10)).rejects.toThrow("fallo inyectado");
    expect(filas).toHaveLength(0);
    expect(auditoria).toHaveLength(0);
    expect(eventos).toContain("rollback");
    expect(eventos).not.toContain("commit");
  });
  it("39) carrera entre vista previa e importación: si otro creó una revisión de un empleado, TODO se revierte con el número de fila", async () => {
    filas.push({ id_empleado: 4, ejercicio: 2026, revision: 1, confirmado_en: null }); // otro usuario guardó un borrador tras el análisis
    const previas = filas.length;
    await expect(importar(10)).rejects.toThrow("Fila 5: La revisión cambió");
    expect(filas).toHaveLength(previas);
    expect(auditoria).toHaveLength(0);
    expect(eventos).toContain("rollback");
  });
  it("39b) carrera con una revisión CONFIRMADA o una planilla autorizada nueva: también revierte todo", async () => {
    filas.push({ id_empleado: 2, ejercicio: 2026, revision: 1, confirmado_en: "2026-10-04" });
    await expect(importar(10)).rejects.toBeInstanceOf(ErrorImportacionFiscal);
    expect(filas).toHaveLength(1);
    filas = []; eventos = [];
    h.solape.add(6); // se autorizó una planilla del empleado 6 entre el análisis y la importación
    await expect(importar(10)).rejects.toThrow("doble conteo");
    expect(filas).toHaveLength(0);
    expect(eventos).not.toContain("commit");
  });
  it("40) el doble submit no duplica: la segunda importación del mismo archivo falla (ya existen los borradores) sin crear nada", async () => {
    await importar(10);
    await expect(importar(10)).rejects.toThrow("La revisión cambió");
    expect(filas).toHaveLength(10);
    expect(new Set(filas.map((f) => f.id_empleado)).size).toBe(10);
  });
  it("41) auditoría consistente: 1 evento por empleado (con IMPORTACION_EXCEL, fila y archivo) + 1 evento general, todo antes del COMMIT", async () => {
    await importar(10);
    const individuales = auditoria.filter((a) => a.accion === "CAPTURAR_ACUMULADO_FISCAL_INICIAL");
    expect(individuales).toHaveLength(10);
    for (const a of individuales) { expect(a.detalle).toContain("IMPORTACION_EXCEL"); expect(a.detalle).toContain('archivo "Acumulados_2026.xlsx"'); expect(a.usuario).toBe("rrhh.ana"); }
    const general = auditoria.filter((a) => a.accion === "IMPORTAR_ACUMULADOS_FISCALES");
    expect(general).toHaveLength(1);
    expect(general[0].detalle).toContain("ejercicio 2026");
    expect(general[0].detalle).toContain("10 borradores");
    expect(general[0].detalle).toContain("Acumulados_2026.xlsx");
    expect(eventos.lastIndexOf("audit")).toBeLessThan(eventos.indexOf("commit"));
    expect(JSON.stringify(auditoria)).not.toContain("PK"); // nunca el binario del Excel
  });
  it("una fila inválida según el modelo se rechaza ANTES de abrir la transacción", async () => {
    const malos = items(3); (malos[1].antecedente as AntecedenteFiscal).ingresosGravadosPrevios = "-1.00";
    await expect(importarAcumuladosFiscales(7, malos, "rrhh", "a.xlsx")).rejects.toThrow("Fila 3");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it("sin filas → error explícito; sin usuario → error", async () => {
    await expect(importarAcumuladosFiscales(7, [], "rrhh", "a.xlsx")).rejects.toThrow("No hay filas");
    await expect(importarAcumuladosFiscales(7, items(1), " ", "a.xlsx")).rejects.toThrow();
  });
  it("los locks se toman en orden estable por empleado (sin deadlocks entre importaciones concurrentes)", async () => {
    const desordenado = items(5).reverse();
    await importarAcumuladosFiscales(7, desordenado, "rrhh", "a.xlsx");
    expect(filas.map((f) => f.id_empleado)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("REGRESIÓN — captura y confirmación individuales (#360) intactas", () => {
  it("42) la captura individual sigue creando UNA revisión en su propia transacción", async () => {
    expect(await capturarAntecedentesFiscales(7, 9, 2026, migracion(), "capturador", 0)).toEqual({ id: 1, revision: 1 });
    expect(auditoria[0]).toMatchObject({ accion: "CAPTURAR_ACUMULADO_FISCAL_INICIAL" });
    expect(auditoria[0].detalle).not.toContain("IMPORTACION_EXCEL");
  });
  it("43) la confirmación individual sigue exigiendo una revisión existente sin confirmar", async () => {
    await capturarAntecedentesFiscales(7, 9, 2026, migracion(), "capturador", 0);
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("information_schema")) return [["empleados", "documentos_empleados", "auditoria", "rrhh_fiscal_empleado_ejercicio"].map((TABLE_NAME) => ({ TABLE_NAME, ENGINE: "InnoDB" }))];
      if (sql.startsWith("SELECT id FROM empleados")) return [[{ id: 9 }]];
      if (sql.includes("SELECT * FROM rrhh_fiscal_empleado_ejercicio")) return [[]];
      throw new Error("inesperada");
    });
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "gerente")).rejects.toThrow("no encontrados");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  datosFiscalesSchema, MSG_MIGRACION_SOLAPADA, parsearDatosFiscales, tipoOrigenFiscal, validarAntecedenteFiscal, type AntecedenteFiscal,
} from "./fiscal-modelo";
import { capturarAntecedentesFiscales, confirmarAntecedentesFiscales } from "./fiscal-antecedentes";

/**
 * ACUMULADO FISCAL INICIAL DE MIGRACIÓN — modelo (validación, compatibilidad histórica) y revisiones (borrador → confirmar,
 * inmutabilidad, concurrencia, anti doble conteo). Sin BD real: pool simulado. Reloj fijo: 2026-10-05.
 */
const HOY = "2026-10-05";
const migracion = (over: Partial<AntecedenteFiscal> = {}): AntecedenteFiscal => ({
  inicioFiscal: "2026-01-01", corteAntecedentes: "2026-09-30",
  ingresosGravadosPrevios: "45000.00", ingresosExentosPrevios: "2000.00", igssLaboralPrevio: "2173.50", isrRetenidoPrevio: "1250.00",
  datos: {
    version: 1, declaracionAntecedentes: "ACUMULADO_INICIAL_MIGRACION", constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [],
    otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] },
    migracion: { referenciaOrigen: "Reporte de cierre del sistema anterior", observacion: null, documentoId: null },
  },
  ...over,
});
const sinAntecedentes = (): AntecedenteFiscal => ({
  inicioFiscal: null, corteAntecedentes: null, ingresosGravadosPrevios: "0.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00",
  datos: { version: 1, declaracionAntecedentes: "SIN_ANTECEDENTES", constancias: [], ingresosPreviosPorConcepto: [], ajustesPrevios: [], deducciones: [], otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] } },
});
const validar = (a: unknown, confirmar = false) => validarAntecedenteFiscal(a, 2026, confirmar, HOY);

describe("MODELO — acumulado inicial de migración", () => {
  it("1) un acumulado válido (caso real: corte 30/09, Q45,000 / Q2,000 / Q2,173.50 / Q1,250) se acepta y confirma", () => {
    expect(validar(migracion())).toEqual(migracion());
    expect(validar(migracion(), true).ingresosGravadosPrevios).toBe("45000.00");
  });
  it("2) valores en cero son válidos (no se asume ni se exige desglose)", () => {
    const a = migracion({ ingresosGravadosPrevios: "0.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00" });
    expect(() => validar(a, true)).not.toThrow();
  });
  it.each(["-1.00", "-0.01"])("3) monto negativo inválido: %s", (m) => expect(() => validar(migracion({ isrRetenidoPrevio: m }))).toThrow());
  it.each(["1.005", "10.123", "100", "1e3", "1,000.00"])("4) más de 2 decimales / formato ambiguo inválido: %s", (m) => expect(() => validar(migracion({ igssLaboralPrevio: m }))).toThrow());
  it("5) corte fuera del ejercicio inválido", () => {
    expect(() => validar(migracion({ corteAntecedentes: "2025-12-31" }))).toThrow("fuera del ejercicio");
    expect(() => validar(migracion({ corteAntecedentes: "2027-01-01" }))).toThrow();
  });
  it("6) corte futuro inválido (posterior a hoy)", () => {
    expect(() => validar(migracion({ corteAntecedentes: "2026-10-06" }))).toThrow("posterior a hoy");
    expect(() => validar(migracion({ corteAntecedentes: HOY }))).not.toThrow(); // hoy mismo sí
  });
  it("la fecha de corte es obligatoria y el inicio debe ser el 1 de enero del ejercicio", () => {
    expect(() => validar(migracion({ corteAntecedentes: null }))).toThrow("fecha de corte");
    expect(() => validar(migracion({ inicioFiscal: "2026-02-01" }))).toThrow("1 de enero");
    expect(validar(migracion({ inicioFiscal: null }), true).inicioFiscal).toBe("2026-01-01");
  });
  it("el acumulado requiere origen/referencia", () => {
    const a = migracion(); delete (a.datos as { migracion?: unknown }).migracion;
    expect(() => validar(a)).toThrow("origen");
  });
  it("7) SIN_ANTECEDENTES + datos/valores de migración es incompatible (origen ambiguo)", () => {
    const a = sinAntecedentes(); a.datos.migracion = { referenciaOrigen: "x", observacion: null, documentoId: null };
    expect(() => validar(a)).toThrow("solo aplican al acumulado inicial");
    const b = sinAntecedentes(); b.ingresosGravadosPrevios = "45000.00";
    expect(() => validar(b, true)).toThrow("incompatible");
  });
  it("8) migración + constancias/ingresos/deducciones de otro patrono en la MISMA revisión: falla cerrado (caso mixto no soportado)", () => {
    const a = migracion();
    a.datos.constancias = [{ id: "c1", patronoNit: "1-2", numero: "1", periodoDesde: "2026-01-01", periodoHasta: "2026-03-31", documentoId: 5 }];
    expect(() => validar(a)).toThrow("no está soportado");
    const b = migracion(); b.datos.otrosPatronos = { declaracion: "SI", agenteRetenedor: "OTRO_PATRONO", remuneraciones: [] };
    expect(() => validar(b)).toThrow("no está soportado");
    const c = migracion(); c.datos.deducciones = [{ id: "d1", tipo: "DONACION", montoSolicitado: "10.00", fecha: "2026-05-01", documentoId: 5, estadoComprobacion: "PENDIENTE", motivo: null }];
    expect(() => validar(c)).toThrow("no está soportado");
  });
  it("9) JSON histórico (sin `migracion`) sigue parseando exactamente igual", () => {
    for (const declaracion of ["SIN_ANTECEDENTES", "CON_ANTECEDENTES", "DESCONOCIDO"] as const) {
      const d = { ...sinAntecedentes().datos, declaracionAntecedentes: declaracion };
      expect(parsearDatosFiscales(JSON.stringify(d))).toEqual(d);
      expect(datosFiscalesSchema.safeParse(d).success).toBe(true);
    }
    expect(() => parsearDatosFiscales({ ...sinAntecedentes().datos, autorizado: true })).toThrow(); // sigue estricto
  });
  it("origen fiscal explícito, derivado también para registros anteriores", () => {
    expect(tipoOrigenFiscal(migracion().datos)).toBe("ACUMULADO_INICIAL_MIGRACION");
    expect(tipoOrigenFiscal(sinAntecedentes().datos)).toBe("SIN_ANTECEDENTES");
    expect(tipoOrigenFiscal({ ...sinAntecedentes().datos, declaracionAntecedentes: "CON_ANTECEDENTES" })).toBe("ANTECEDENTES_OTRO_PATRONO");
  });
});

// ------------------------------------------------------------------------------------------------ revisiones
type Fila = Record<string, unknown>;
const conn = { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
let filas: Fila[];
let solape: boolean;
const fila = (revision: number, a: AntecedenteFiscal, confirmado: boolean): Fila => ({
  id: revision, revision, inicio_fiscal: a.inicioFiscal, corte_antecedentes: a.corteAntecedentes,
  ingresos_gravados_previos: a.ingresosGravadosPrevios, ingresos_exentos_previos: a.ingresosExentosPrevios,
  igss_laboral_previo: a.igssLaboralPrevio, isr_retenido_previo: a.isrRetenidoPrevio, datos: JSON.stringify(a.datos),
  creado_por: "capturador", creado_en: "2026-10-01", confirmado_por: confirmado ? "rrhh" : null, confirmado_en: confirmado ? "2026-10-02" : null,
});

describe("REVISIONES — borrador, confirmación, inmutabilidad y anti doble conteo", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-05T18:00:00Z"));
    vi.resetAllMocks();
    filas = []; solape = false;
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
    conn.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("information_schema")) return [["empleados", "documentos_empleados", "auditoria", "rrhh_fiscal_empleado_ejercicio"].map((TABLE_NAME) => ({ TABLE_NAME, ENGINE: "InnoDB" }))];
      if (sql.startsWith("SELECT id FROM empleados")) return [[{ id: 9 }]];
      if (sql.includes("FROM rrhh_planilla_periodos p")) return [solape ? [{ id: 30 }] : []];
      if (sql.includes("FROM documentos_empleados")) return [params.slice(2).map((id) => ({ id }))];
      if (sql.includes("SELECT *")) return [sql.includes("confirmado_en IS NOT NULL") ? filas.filter((r) => r.confirmado_en !== null).slice(0, 1) : filas];
      if (sql.startsWith("INSERT")) { filas = [fila(Number(params[3]), migracion(), false), ...filas]; return [{ insertId: 2, affectedRows: 1 }]; }
      if (sql.startsWith("UPDATE")) { filas = filas.map((r) => (r.revision === params[4] ? { ...r, confirmado_por: params[0], confirmado_en: "2026-10-05" } : r)); return [{ affectedRows: 1 }]; }
      throw new Error(`consulta no esperada: ${sql.slice(0, 60)}`);
    });
  });
  afterEach(() => vi.useRealTimers());

  it("10) guardar borrador crea la revisión SIN confirmarla y audita CAPTURAR_ACUMULADO_FISCAL_INICIAL", async () => {
    expect(await capturarAntecedentesFiscales(7, 9, 2026, migracion(), "capturador", 0)).toEqual({ id: 2, revision: 1 });
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE"))).toBe(false); // no confirma
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      accion: "CAPTURAR_ACUMULADO_FISCAL_INICIAL", usuario: "capturador",
      detalle: expect.stringContaining("tipo ACUMULADO_INICIAL_MIGRACION corte 2026-09-30 gravado 45000.00 exento 2000.00 igss 2173.50 isr 1250.00"),
    }));
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("11) confirmar registra quién confirmó y audita CONFIRMAR_ACUMULADO_FISCAL_INICIAL", async () => {
    filas = [fila(1, migracion(), false)];
    expect(await confirmarAntecedentesFiscales(7, 9, 2026, 1, "gerente")).toEqual({ revision: 1 });
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("SET confirmado_por = ?, confirmado_en = CURRENT_TIMESTAMP"), ["gerente", 7, 9, 2026, 1]);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ accion: "CONFIRMAR_ACUMULADO_FISCAL_INICIAL", usuario: "gerente" }));
  });

  it("12) una revisión confirmada NO se edita en sitio (ni se puede confirmar de nuevo)", async () => {
    filas = [fila(1, migracion(), true)];
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "gerente")).rejects.toThrow("ya confirmada");
    await capturarAntecedentesFiscales(7, 9, 2026, migracion({ ingresosGravadosPrevios: "46000.00" }), "capturador", 1);
    expect(conn.execute.mock.calls.filter(([sql]) => String(sql).startsWith("UPDATE"))).toHaveLength(0); // corregir = INSERT de revisión nueva
  });

  it("13) una nueva revisión confirmada sustituye a la anterior como ÚLTIMA CONFIRMADA (la que usa el motor)", async () => {
    filas = [fila(1, migracion(), true)];
    await capturarAntecedentesFiscales(7, 9, 2026, migracion(), "capturador", 1);
    await confirmarAntecedentesFiscales(7, 9, 2026, 2, "gerente");
    const confirmadas = filas.filter((r) => r.confirmado_en !== null).map((r) => r.revision);
    expect(confirmadas.sort()).toEqual([1, 2]);
    // la lectura del motor toma la de mayor revisión confirmada (ORDER BY revision DESC LIMIT 1)
    const sqlConfirmada = conn.execute.mock.calls.find(([sql]) => String(sql).includes("confirmado_en IS NOT NULL"));
    expect(sqlConfirmada).toBeUndefined(); // (esta prueba no lee); la garantía está en el SQL del núcleo:
    expect(readFileSync("src/lib/rrhh/fiscal-antecedentes.ts", "utf8")).toContain("AND confirmado_en IS NOT NULL ORDER BY revision DESC LIMIT 1");
  });

  it("14) la concurrencia por expectedRevision sigue funcionando", async () => {
    filas = [fila(2, migracion(), false)];
    await expect(capturarAntecedentesFiscales(7, 9, 2026, migracion(), "capturador", 1)).rejects.toThrow("revisión cambió");
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).startsWith("INSERT"))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("22) ANTI DOBLE CONTEO: con una planilla AUTORIZADA que se solapa con enero→corte, capturar y confirmar bloquean con mensaje explícito", async () => {
    solape = true; // p.ej. planilla autorizada 16/09–30/09 con corte 30/09
    await expect(capturarAntecedentesFiscales(7, 9, 2026, migracion(), "capturador", 0)).rejects.toThrow(MSG_MIGRACION_SOLAPADA);
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).startsWith("INSERT"))).toBe(false);
    filas = [fila(1, migracion(), false)];
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "gerente")).rejects.toThrow("doble conteo");
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).startsWith("UPDATE"))).toBe(false);
  });

  it("23) corte anterior a la primera planilla nueva: correcto (la consulta de solapamiento acota empresa, empleado, autorizadas y enero→corte)", async () => {
    solape = false;
    await expect(capturarAntecedentesFiscales(7, 9, 2026, migracion(), "capturador", 0)).resolves.toEqual({ id: 2, revision: 1 });
    const c = conn.execute.mock.calls.find(([sql]) => String(sql).includes("FROM rrhh_planilla_periodos p"))!;
    expect(String(c[0])).toContain("p.autorizado_en IS NOT NULL");
    expect(String(c[0])).toContain("p.fecha_inicio <= ? AND p.fecha_fin >= ?");
    expect(c[1]).toEqual([7, 9, "2026-09-30", "2026-01-01"]);
  });

  it("regresión 25/26: SIN_ANTECEDENTES y CON_ANTECEDENTES no consultan planillas ni cambian su auditoría", async () => {
    await capturarAntecedentesFiscales(7, 9, 2026, sinAntecedentes(), "capturador", 0);
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).includes("rrhh_planilla_periodos"))).toBe(false);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ accion: "CAPTURAR_ANTECEDENTES_FISCALES" }));
  });
});

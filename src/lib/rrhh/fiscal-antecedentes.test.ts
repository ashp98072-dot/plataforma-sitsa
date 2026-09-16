import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AntecedenteFiscal } from "./fiscal-modelo";
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { capturarAntecedentesFiscales, confirmarAntecedentesFiscales, leerAntecedentesFiscales } from "./fiscal-antecedentes";

const base = (): AntecedenteFiscal => ({ inicioFiscal: null, corteAntecedentes: null,
  ingresosGravadosPrevios: "0.00", ingresosExentosPrevios: "0.00", igssLaboralPrevio: "0.00", isrRetenidoPrevio: "0.00",
  datos: { version: 1, declaracionAntecedentes: "SIN_ANTECEDENTES", constancias: [], ingresosPreviosPorConcepto: [],
    ajustesPrevios: [], deducciones: [], otrosPatronos: { declaracion: "NO", agenteRetenedor: "ESTA_EMPRESA", remuneraciones: [] } } });
const fila = (revision = 1, confirmado = false) => ({ id: revision, revision, inicio_fiscal: null, corte_antecedentes: null,
  ingresos_gravados_previos: "0.00", ingresos_exentos_previos: "0.00", igss_laboral_previo: "0.00", isr_retenido_previo: "0.00",
  datos: JSON.stringify(base().datos), creado_por: "capturador", creado_en: "2026-09-16", confirmado_por: confirmado ? "rrhh" : null,
  confirmado_en: confirmado ? "2026-09-16" : null });
const conn = { execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
let rows: ReturnType<typeof fila>[];
let employeeFound: boolean, docsFound: boolean, engine: string;
beforeEach(() => {
  vi.resetAllMocks(); rows = []; employeeFound = true; docsFound = true; engine = "InnoDB";
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  conn.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("information_schema")) return [["empleados", "documentos_empleados", "auditoria", "rrhh_fiscal_empleado_ejercicio"].map((TABLE_NAME) => ({ TABLE_NAME, ENGINE: engine }))];
    if (sql.startsWith("SELECT id FROM empleados")) return [employeeFound ? [{ id: 9, estado: "Baja" }] : []];
    if (sql.includes("FROM documentos_empleados")) return [docsFound ? params.slice(2).map((id) => ({ id })) : []];
    if (sql.includes("SELECT *")) return [sql.includes("confirmado_en IS NOT NULL") ? rows.filter((r) => r.confirmado_en !== null) : rows];
    if (sql.startsWith("INSERT")) return [{ insertId: 2, affectedRows: 1 }];
    if (sql.startsWith("UPDATE")) return [{ affectedRows: 1 }];
    throw new Error("Consulta no esperada");
  });
});
describe("antecedentes fiscales tenant/transacción", () => {
  it("primera captura serializa sobre empleado y audita dentro de transacción", async () => {
    expect(await capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 0)).toEqual({ id: 2, revision: 1 });
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ? AND id = ? FOR UPDATE"), [7, 9]);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO rrhh_fiscal_empleado_ejercicio"),
      expect.arrayContaining([7, 9, 2026, 1, "rrhh"]));
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ empresaId: 7, usuario: "rrhh", accion: "CAPTURAR_ANTECEDENTES_FISCALES" }));
    expect(conn.commit).toHaveBeenCalledOnce(); expect(conn.release).toHaveBeenCalledOnce();
  });
  it("corregir confirmada crea revisión sin actualizarla", async () => {
    rows = [fila(1, true)];
    expect(await capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 1)).toEqual({ id: 2, revision: 2 });
    expect(conn.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("revisión obsoleta rechaza antes de escribir", async () => {
    rows = [fila(2)];
    await expect(capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 1)).rejects.toThrow("revisión cambió");
    expect(conn.execute.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(false);
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
  it("dos capturas con la misma revisión: tras el lock solo una inserta", async () => {
    // Interleaving simulado de dos conexiones; no requiere ejecutar SQL real.
    let locked = false;
    let unlock: (() => void) | undefined;
    let signalInsert: (() => void) | undefined;
    let continueInsert: (() => void) | undefined;
    const inserted = new Promise<void>((resolve) => { signalInsert = resolve; });
    const allowInsert = new Promise<void>((resolve) => { continueInsert = resolve; });
    const waitLock = new Promise<void>((resolve) => { unlock = resolve; });
    const executeBase = conn.execute.getMockImplementation()!;
    const connections = [0, 1].map(() => ({ ...conn, commit: vi.fn(async () => unlock!()), rollback: vi.fn(), release: vi.fn(),
      execute: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("FROM empleados") && sql.includes("FOR UPDATE")) {
          if (locked) await waitLock; else locked = true;
        }
        if (sql.startsWith("INSERT")) {
          signalInsert!(); await allowInsert; rows = [fila(1)];
        }
        return executeBase(sql, params);
      }) }));
    const getConnection = vi.fn().mockResolvedValueOnce(connections[0]).mockResolvedValueOnce(connections[1]);
    vi.mocked(getPool).mockReturnValue({ getConnection } as never);
    const first = capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 0);
    await inserted;
    const second = capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 0);
    const rejection = expect(second).rejects.toThrow("revisión cambió");
    continueInsert!(); await first; await rejection;
    expect(registrarAuditoriaTx).toHaveBeenCalledOnce();
    expect(connections[0].commit).toHaveBeenCalledOnce(); expect(connections[1].commit).not.toHaveBeenCalled();
  });
  it.each(["captura", "confirmación", "lectura"]) ("empleado ajeno/no existente impide %s", async (action) => {
    employeeFound = false;
    const call = action === "captura" ? capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 0) :
      action === "confirmación" ? confirmarAntecedentesFiscales(7, 9, 2026, 1, "rrhh") : leerAntecedentesFiscales(7, 9, 2026);
    await expect(call).rejects.toThrow("Empleado no encontrado");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled(); expect(conn.commit).not.toHaveBeenCalled();
  });
  it("evidencia ajena al empleado/empresa impide captura", async () => {
    docsFound = false;
    const a = base(); a.datos.deducciones = [{ id: "d1", tipo: "DONACION", montoSolicitado: "10.00", fecha: "2026-02-01", documentoId: 80, estadoComprobacion: "PENDIENTE", motivo: null }];
    await expect(capturarAntecedentesFiscales(7, 9, 2026, a, "rrhh", 0)).rejects.toThrow("Evidencia");
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ? AND id_empleado = ? AND id IN"), [7, 9, 80]);
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("Baja conserva lectura histórica y anterior confirmada ante borrador", async () => {
    rows = [fila(2), fila(1, true)];
    const result = await leerAntecedentesFiscales(7, 9, 2026);
    expect(result.ultima?.revision).toBe(2); expect(result.confirmada?.revision).toBe(1);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("empresa_id = ? AND id_empleado = ? AND ejercicio = ?"), [7, 9, 2026]);
    expect(conn.execute.mock.calls.some(([sql]) => sql.includes("estado ="))).toBe(false);
  });
  it("confirmación solo añade responsable/fecha, sin economía ni liquidación", async () => {
    rows = [fila()];
    await confirmarAntecedentesFiscales(7, 9, 2026, 1, "rrhh");
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("SET confirmado_por = ?, confirmado_en = CURRENT_TIMESTAMP"), ["rrhh", 7, 9, 2026, 1]);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ accion: "CONFIRMAR_ANTECEDENTES_FISCALES" }));
    expect(conn.execute.mock.calls.some(([sql]) => /planilla|liquidaciones|cuotas|horas_extra/.test(sql))).toBe(false);
  });
  it("doble confirmación rechaza sin nueva escritura/auditoría", async () => {
    rows = [fila(1, true)];
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "rrhh")).rejects.toThrow("ya confirmada");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("JSON corrupto no confirma ni se presenta vacío", async () => {
    rows = [{ ...fila(), datos: "{" }];
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "rrhh")).rejects.toThrow("almacenados inválidos");
    await expect(leerAntecedentesFiscales(7, 9, 2026)).rejects.toThrow("almacenados inválidos");
  });
  it("fallo de auditoría revierte confirmación y libera conexión", async () => {
    rows = [fila()]; vi.mocked(registrarAuditoriaTx).mockRejectedValue(new Error("auditoría"));
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "rrhh")).rejects.toThrow("auditoría");
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled(); expect(conn.release).toHaveBeenCalledOnce();
  });
  it("fallo de auditoría también revierte captura", async () => {
    vi.mocked(registrarAuditoriaTx).mockRejectedValue(new Error("auditoría"));
    await expect(capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 0)).rejects.toThrow("auditoría");
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
  });
  it("confirmación revalida evidencias antes de su primera escritura", async () => {
    docsFound = false;
    const a = base(); a.datos.deducciones = [{ id: "d1", tipo: "DONACION", montoSolicitado: "10.00", fecha: "2026-02-01", documentoId: 80, estadoComprobacion: "PENDIENTE", motivo: null }];
    rows = [{ ...fila(), datos: JSON.stringify(a.datos) }];
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "rrhh")).rejects.toThrow("Evidencia");
    expect(conn.execute.mock.calls.some(([sql]) => sql.startsWith("UPDATE"))).toBe(false);
  });
  it("confirmación completa se rechaza si cambió la revisión", async () => {
    rows = [fila(2)];
    await expect(confirmarAntecedentesFiscales(7, 9, 2026, 1, "rrhh")).rejects.toThrow("revisión cambió");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
  it("engine no transaccional bloquea escritura", async () => {
    engine = "MyISAM";
    await expect(capturarAntecedentesFiscales(7, 9, 2026, base(), "rrhh", 0)).rejects.toThrow("InnoDB");
    expect(conn.beginTransaction).not.toHaveBeenCalled(); expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
});

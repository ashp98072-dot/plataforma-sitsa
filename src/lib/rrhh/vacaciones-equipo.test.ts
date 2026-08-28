import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("./vacaciones", () => ({ contarDiasHabiles: vi.fn(), calcularSaldoTotalDisponible: vi.fn(), registrarVacacionesFifoEnConexion: vi.fn(), sincronizarPeriodosVacacionesEnConexion: vi.fn() }));
import { query, getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { contarDiasHabiles, calcularSaldoTotalDisponible, registrarVacacionesFifoEnConexion } from "./vacaciones";
import { crearSolicitudVacaciones } from "./solicitudes-vacaciones";
import { listarEquipoVacaciones } from "./vacaciones-equipo";
const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const rows = (data: Record<string, unknown>[]) => data as RowDataPacket[];
const input = { empresaId: 7, empleadoId: 20, solicitanteId: 10, fechaInicio: "2026-09-01", fechaFin: "2026-09-02", comentario: "Prueba" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue(rows([{ id: 20, codigo: "E20", nombre: "Colaborador" }]));
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as unknown as ReturnType<typeof getPool>);
  vi.mocked(contarDiasHabiles).mockResolvedValue(2);
  vi.mocked(calcularSaldoTotalDisponible).mockResolvedValue(15);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("empleado_supervisores")) return [[{ id: 20 }]];
    if (sql.includes("FROM empleados")) return [[{ id: 10, nombre: "Jefe" }, { id: 20, nombre: "Colaborador" }]];
    if (sql.includes("FROM solicitudes_vacaciones")) return [[]];
    throw new Error("SQL inesperado");
  });
  conn.execute.mockResolvedValue([{ insertId: 123 }]);
});
afterEach(() => vi.restoreAllMocks());
describe("vacaciones solicitadas por supervisor", () => {
  it("lista exclusivamente equipo activo de la misma empresa, sin condición de horas extra", async () => {
    expect(await listarEquipoVacaciones(7, 10)).toEqual([{ id: 20, codigo: "E20", nombre: "Colaborador" }]);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("es.empresa_id = e.empresa_id");
    expect(sql).toContain("s.empresa_id = es.empresa_id");
    expect(sql).toContain("e.estado = 'Activo' AND s.estado = 'Activo'");
    expect(sql).not.toContain("horas_extra");
    expect(params).toEqual([7, 10]);
  });
  it("otro equipo/empresa no puede consultar saldo ni insertar", async () => {
    vi.mocked(query).mockResolvedValue([]);
    expect((await crearSolicitudVacaciones(input)).ok).toBe(false);
    expect(calcularSaldoTotalDisponible).not.toHaveBeenCalled();
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });
  it("revalida relación bajo lock e inserta pendiente con autor real y auditoría", async () => {
    expect(await crearSolicitudVacaciones(input)).toMatchObject({ ok: true, id: 123 });
    const auth = conn.query.mock.calls.find(([sql]) => sql.includes("empleado_supervisores"))!;
    expect(auth[0]).toContain("FOR UPDATE");
    expect(auth[1]).toEqual([7, 10, 20]);
    expect(conn.execute.mock.calls[0][0]).toContain("'Pendiente'");
    expect(conn.execute.mock.calls[0][1]).toEqual([7, 20, "Vacaciones", "2026-09-01", "2026-09-02", 2, "Registrada por supervisor: Jefe (#10).\nPrueba"]);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ usuario: "portal:10", detalle: expect.stringContaining("beneficiario #20") }));
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(registrarVacacionesFifoEnConexion).not.toHaveBeenCalled();
  });
  it("revocación entre lectura e inserción bloquea sin escritura", async () => {
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => String(args[0]).includes("empleado_supervisores") ? [[]] : normal(...args));
    expect((await crearSolicitudVacaciones(input)).ok).toBe(false);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
  it("evita duplicar solicitud pendiente y bloquea empleado antes de comprobarla", async () => {
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => String(args[0]).includes("FROM solicitudes_vacaciones") ? [[{ id: 123 }]] : normal(...args));
    expect((await crearSolicitudVacaciones(input)).ok).toBe(false);
    expect(conn.query.mock.calls[0][0]).toContain("ORDER BY id FOR UPDATE");
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
  it("saldo insuficiente no crea solicitud", async () => {
    vi.mocked(calcularSaldoTotalDisponible).mockResolvedValue(1);
    expect((await crearSolicitudVacaciones(input)).mensaje).toContain("Saldo insuficiente");
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("fallo de auditoría revierte la solicitud", async () => {
    vi.mocked(registrarAuditoriaTx).mockRejectedValue(new Error("audit"));
    await expect(crearSolicitudVacaciones(input)).rejects.toThrow("audit");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it("autoservicio anterior sigue funcionando sin relación de supervisión", async () => {
    expect((await crearSolicitudVacaciones({ ...input, solicitanteId: undefined })).ok).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls[0][1][6]).toBe("Prueba");
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ usuario: "portal:20" }));
  });
});

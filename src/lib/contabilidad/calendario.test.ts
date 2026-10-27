import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ getConnection: vi.fn(), query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), auditar: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.getConnection }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.auditar }));
import { crearEjercicioConPeriodos, listarEjercicios, listarPeriodos } from "./calendario";
const entrada = { codigo: "E", fechaInicio: "2026-01-01", fechaFin: "2026-01-02", periodos: [
  { codigo: "A", fechaInicio: "2026-01-01", fechaFin: "2026-01-01" }, { codigo: "B", fechaInicio: "2026-01-02", fechaFin: "2026-01-02" },
] };
const ambito = { entidadId: 9, usuarioId: 4, admin: false };
const conn = { query: m.query, execute: m.execute, beginTransaction: m.beginTransaction, commit: m.commit, rollback: m.rollback, release: m.release };
beforeEach(() => {
  vi.resetAllMocks(); m.getConnection.mockResolvedValue(conn);
  m.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM empresas")) return [[{ id: 7 }]];
    if (sql.includes("FROM cont_entidades")) return [[{ id: 9, activa: 1 }]];
    return [[]];
  });
  m.execute.mockResolvedValue([{ insertId: 12 }]);
});
describe("C3C-1: servicios con conexiones simuladas (sin MySQL)", () => {
  it.each(["ER_CHECKREAD", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT", "ER_INTERNAL_ERROR"])("preserva %s tras rollback, sin retry ni conversión funcional", async (code) => {
    const fallo = Object.assign(new Error("fallo del motor"), { code, sqlState: "HY000" });
    m.query.mockRejectedValueOnce(fallo);
    await expect(crearEjercicioConPeriodos(7, "actor", ambito, entrada)).rejects.toBe(fallo);
    expect(m.rollback).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce();
    expect(m.getConnection).toHaveBeenCalledOnce(); expect(m.commit).not.toHaveBeenCalled();
    expect(m.auditar).not.toHaveBeenCalled();
  });
  it("valida antes de adquirir conexión", async () => {
    await expect(crearEjercicioConPeriodos(7, "actor", ambito, {})).rejects.toThrow();
    expect(m.getConnection).not.toHaveBeenCalled();
  });
  it("bloquea empresa y entidad ANTES de buscar conflictos e insertar; audita antes del commit", async () => {
    expect(await crearEjercicioConPeriodos(7, "actor", ambito, entrada)).toEqual({ id: 12 });
    expect(m.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(m.query.mock.invocationCallOrder[0]);
    expect(m.query.mock.calls.every(([sql]) => sql.endsWith("FOR UPDATE"))).toBe(true);
    expect(m.query.mock.invocationCallOrder[2]).toBeLessThan(m.execute.mock.invocationCallOrder[0]);
    expect(m.query.mock.calls.map((c) => c[0])).toEqual([
      expect.stringContaining("FROM empresas WHERE id = ? FOR UPDATE"),
      expect.stringContaining("FROM cont_entidades WHERE empresa_id = ? AND id = ? FOR UPDATE"),
      expect.stringContaining("fecha_inicio <= ? AND fecha_fin >= ?"),
    ]);
    expect(m.query.mock.calls[2][1]).toEqual([7, 9, "E", "2026-01-02", "2026-01-01"]);
    expect(m.execute).toHaveBeenCalledTimes(3);
    expect(m.execute.mock.calls[1][1]).toEqual([7, 9, 12, "A", 1, "2026-01-01", "2026-01-01", 4]);
    expect(m.execute.mock.calls.every((c) => c[0].includes("'CONFIGURADO'"))).toBe(true);
    expect(m.auditar.mock.calls[0][0]).toBe(conn);
    expect(JSON.parse(m.auditar.mock.calls[0][1].detalle)).toMatchObject({ entidadId: 9, ejercicioId: 12, actorId: 4, periodos: entrada.periodos });
    expect(m.auditar.mock.invocationCallOrder[0]).toBeLessThan(m.commit.mock.invocationCallOrder[0]);
    expect(m.rollback).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
  });
  it("rechaza código o rango incompatibles sin escribir", async () => {
    m.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[{ id: 9, activa: 1 }]]).mockResolvedValueOnce([[{ id: 21 }]]);
    await expect(crearEjercicioConPeriodos(7, "actor", ambito, entrada)).rejects.toThrow("solapan");
    expect(m.execute).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce();
  });
  it.each(["periodo", "auditoria"])("revierte toda la transacción ante fallo en %s", async (fallo) => {
    if (fallo === "periodo") m.execute.mockResolvedValueOnce([{ insertId: 12 }]).mockRejectedValueOnce(new Error("fallo"));
    else m.auditar.mockRejectedValueOnce(new Error("fallo"));
    await expect(crearEjercicioConPeriodos(7, "actor", ambito, entrada)).rejects.toThrow("fallo");
    expect(m.commit).not.toHaveBeenCalled(); expect(m.rollback).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce();
  });
  it("no escribe para entidad inactiva o ajena", async () => {
    m.query.mockResolvedValueOnce([[{ id: 7 }]]).mockResolvedValueOnce([[{ id: 9, activa: 0 }]]);
    await expect(crearEjercicioConPeriodos(7, "actor", ambito, entrada)).rejects.toThrow("Entidad no disponible");
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("acota lecturas por empresa/entidad, permite consultar entidad inactiva y deniega ejercicio ajeno", async () => {
    expect(await listarEjercicios(7, 9)).toEqual([]);
    expect(m.query.mock.calls[1][1]).toEqual([7, 9]);
    await expect(listarPeriodos(7, 9, 99)).rejects.toThrow("Ejercicio no disponible");
    expect(m.query.mock.calls.at(-1)?.[1]).toEqual([7, 9, 99]);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("dos creaciones incompatibles se serializan en un lock simulado compartido", async () => {
    let cola = Promise.resolve(); let existente = false;
    m.getConnection.mockImplementation(async () => {
      let liberar: (() => void) | undefined;
      return {
        beginTransaction: vi.fn(), release: vi.fn(), rollback: async () => liberar?.(), commit: async () => liberar?.(),
        query: async (sql: string) => {
          if (sql.includes("FROM empresas")) {
            const anterior = cola; cola = new Promise<void>((r) => { liberar = r; }); await anterior; return [[{ id: 7 }]];
          }
          if (sql.includes("FROM cont_entidades")) return [[{ id: 9, activa: 1 }]];
          return [existente ? [{ id: 12 }] : []];
        },
        execute: async (sql: string) => { if (sql.includes("INSERT INTO cont_ejercicios")) existente = true; return [{ insertId: 12 }]; },
      };
    });
    const r = await Promise.allSettled([crearEjercicioConPeriodos(7, "actor", ambito, entrada), crearEjercicioConPeriodos(7, "actor", ambito, entrada)]);
    expect(r.map((v) => v.status)).toEqual(["fulfilled", "rejected"]);
    expect((r[1] as PromiseRejectedResult).reason).toMatchObject({ status: 409, message: expect.stringContaining("solapan") });
    expect(m.auditar).toHaveBeenCalledOnce();
  });
});

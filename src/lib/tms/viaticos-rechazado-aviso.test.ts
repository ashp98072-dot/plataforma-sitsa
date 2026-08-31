import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));

import { execute, query } from "@/lib/db";
import { listarViaticosRechazadosDelPlan } from "./viaticos";

/**
 * PROGRAMACION-RECHAZADO-AVISO-1 — listarViaticosRechazadosDelPlan es
 * PURAMENTE informativa: solo SELECT, nunca modifica nada, nunca bloquea
 * la asignación operativa (eso lo decide el llamador, que solo la usa
 * para construir advertencias no bloqueantes — ver
 * src/app/api/empresas/[slug]/tms/planes/route.ts).
 */

function filaRechazada(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    personal_id: 5,
    personal_nombre: "Carlos Ruiz",
    motivo_rechazo: "No corresponde: el viaje fue cancelado por el cliente.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => vi.restoreAllMocks());

describe("listarViaticosRechazadosDelPlan", () => {
  it("1) mismo plan + RECHAZADO genera aviso", async () => {
    vi.mocked(query).mockResolvedValue([filaRechazada()] as never);
    const r = await listarViaticosRechazadosDelPlan(7, 1, [5]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ personalId: 5, nombre: "Carlos Ruiz", tipo: "RECHAZADO", estadoViatico: "RECHAZADO" });
  });

  it("2) motivoRechazo se incluye en el aviso", async () => {
    vi.mocked(query).mockResolvedValue([filaRechazada()] as never);
    const r = await listarViaticosRechazadosDelPlan(7, 1, [5]);
    expect(r[0].motivoRechazo).toBe("No corresponde: el viaje fue cancelado por el cliente.");
  });

  it("3) sin motivo (null) no rompe", async () => {
    vi.mocked(query).mockResolvedValue([filaRechazada({ motivo_rechazo: null })] as never);
    const r = await listarViaticosRechazadosDelPlan(7, 1, [5]);
    expect(r[0].motivoRechazo).toBeNull();
  });

  it("4) mismo plan + PROGRAMADO no genera aviso (el SQL solo trae estado='RECHAZADO')", async () => {
    vi.mocked(query).mockResolvedValue([] as never); // el SELECT ya filtra por estado='RECHAZADO' — un PROGRAMADO nunca vuelve.
    const r = await listarViaticosRechazadosDelPlan(7, 1, [5]);
    expect(r).toEqual([]);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("v.estado = 'RECHAZADO'");
  });

  it("5) el SQL nunca trae AUTORIZADO/ENTREGADO/LIQUIDADO como si fuera rechazado", async () => {
    // El filtro `estado = 'RECHAZADO'` en el SQL es la única fuente de verdad — ningún otro estado puede colarse.
    vi.mocked(query).mockResolvedValue([] as never);
    await listarViaticosRechazadosDelPlan(7, 1, [5]);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).not.toMatch(/AUTORIZADO|ENTREGADO|LIQUIDADO/);
  });

  it("6) plan distinto: el WHERE siempre filtra por plan_id, nunca trae avisos de otro plan", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarViaticosRechazadosDelPlan(7, 101, [5]);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("v.plan_id = ?");
    expect(params).toEqual([7, 101, 5]);
  });

  it("7) otro tenant: empresa_id viaja SIEMPRE como parámetro real del WHERE, nunca se omite", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarViaticosRechazadosDelPlan(999, 1, [5]);
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("v.empresa_id = ?");
    expect(params![0]).toBe(999);
  });

  it("8) varios rechazados se agrupan en un solo arreglo", async () => {
    vi.mocked(query).mockResolvedValue([
      filaRechazada({ personal_id: 5, personal_nombre: "Carlos Ruiz" }),
      filaRechazada({ personal_id: 6, personal_nombre: "María López", motivo_rechazo: null }),
    ] as never);
    const r = await listarViaticosRechazadosDelPlan(7, 1, [5, 6]);
    expect(r).toHaveLength(2);
    expect(r.map((a) => a.personalId)).toEqual([5, 6]);
  });

  it("9) no duplica: personalIds con ids repetidos se deduplican antes de consultar", async () => {
    vi.mocked(query).mockResolvedValue([filaRechazada()] as never);
    await listarViaticosRechazadosDelPlan(7, 1, [5, 5, 5]);
    const [, params] = vi.mocked(query).mock.calls[0];
    // Solo un placeholder/param por personalId único -- [empresaId, planId, 5], no [.., 5, 5, 5].
    expect(params).toEqual([7, 1, 5]);
  });

  it("lista vacía de personalIds -> [] sin consultar la base de datos", async () => {
    const r = await listarViaticosRechazadosDelPlan(7, 1, []);
    expect(r).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("11) es puramente informativa: nunca ejecuta ninguna escritura (INSERT/UPDATE/DELETE)", async () => {
    vi.mocked(query).mockResolvedValue([filaRechazada()] as never);
    await listarViaticosRechazadosDelPlan(7, 1, [5]);
    expect(execute).not.toHaveBeenCalled();
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql).trim().toUpperCase().startsWith("SELECT")).toBe(true);
  });
});

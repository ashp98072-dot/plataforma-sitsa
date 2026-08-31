import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));

import { execute, query } from "@/lib/db";
import { listarViaticosRechazadosDelPlan, personalRecienAsignadoDelPlan } from "./viaticos";

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

/**
 * PROGRAMACION-RECHAZADO-AVISO-1 (revisión final PR #151) —
 * personalRecienAsignadoDelPlan(): el conjunto que SÍ debe disparar el
 * aviso — solo personal REALMENTE (re)asignado en esta solicitud, nunca
 * el que ya estaba asignado y solo se está revalidando por un cambio de
 * fecha (ver JSDoc en viaticos.ts sobre por qué `recursos` de
 * planes/route.ts no sirve directamente para esto).
 */
describe("personalRecienAsignadoDelPlan", () => {
  it("1) piloto REALMENTE cambia a una persona -> esa persona entra al conjunto (dispararía el aviso si tiene RECHAZADO)", () => {
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: true, pilotoFinal: 5, auxiliaresCambioReal: false, auxiliaresFinal: [], antesAuxiliaresIds: [],
    });
    expect(ids).toEqual([5]);
  });

  it("2) cambiar solo notas (piloto/auxiliares NO cambian) -> conjunto vacío, sin importar fechaCambia/recursos de disponibilidad", () => {
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: false, pilotoFinal: 5, auxiliaresCambioReal: false, auxiliaresFinal: [9], antesAuxiliaresIds: [9],
    });
    expect(ids).toEqual([]);
  });

  it("3) cambiar solo la fecha del viaje (piloto/auxiliares YA asignados, sin cambiar) -> conjunto vacío, aunque se revaliden por disponibilidad", () => {
    // Simula exactamente el caso que gatillaba pilotoIdParaValidar/
    // auxiliaresIdsParaValidar en planes/route.ts (fechaCambia=true) sin
    // que el personal realmente haya cambiado — pilotoCambioReal/
    // auxiliaresCambioReal siguen en false.
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: false, pilotoFinal: 5, auxiliaresCambioReal: false, auxiliaresFinal: [9, 10], antesAuxiliaresIds: [9, 10],
    });
    expect(ids).toEqual([]);
  });

  it("4) agregar un auxiliar NUEVO (los demás siguen igual) -> solo el nuevo entra al conjunto", () => {
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: false, pilotoFinal: 5, auxiliaresCambioReal: true, auxiliaresFinal: [9, 11], antesAuxiliaresIds: [9],
    });
    expect(ids).toEqual([11]);
  });

  it("un auxiliar removido (sin agregar ninguno nuevo) no entra al conjunto — esto no es una (re)asignación nueva", () => {
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: false, pilotoFinal: 5, auxiliaresCambioReal: true, auxiliaresFinal: [9], antesAuxiliaresIds: [9, 11],
    });
    expect(ids).toEqual([]);
  });

  it("piloto y auxiliar nuevo a la vez -> ambos entran al conjunto", () => {
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: true, pilotoFinal: 7, auxiliaresCambioReal: true, auxiliaresFinal: [9, 12], antesAuxiliaresIds: [9],
    });
    expect(ids).toEqual([7, 12]);
  });

  it("pilotoFinal null (se quita el piloto) no se agrega al conjunto aunque pilotoCambioReal sea true", () => {
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: true, pilotoFinal: null, auxiliaresCambioReal: false, auxiliaresFinal: [], antesAuxiliaresIds: [],
    });
    expect(ids).toEqual([]);
  });
});

/**
 * PROGRAMACION-RECHAZADO-AVISO-1 — extremo a extremo de los dos helpers
 * juntos, tal como los usa planes/route.ts.
 */
describe("personalRecienAsignadoDelPlan + listarViaticosRechazadosDelPlan (flujo combinado)", () => {
  it("1) reasignar a una persona RECHAZADA en el mismo plan -> el flujo combinado genera el aviso", async () => {
    vi.mocked(query).mockResolvedValue([filaRechazada({ personal_id: 5 })] as never);
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: true, pilotoFinal: 5, auxiliaresCambioReal: false, auxiliaresFinal: [], antesAuxiliaresIds: [],
    });
    const avisos = await listarViaticosRechazadosDelPlan(7, 1, ids);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].personalId).toBe(5);
  });

  it("2/3) editar notas o fecha sin tocar personal -> el flujo combinado NUNCA consulta la base de datos ni genera aviso", async () => {
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: false, pilotoFinal: 5, auxiliaresCambioReal: false, auxiliaresFinal: [9], antesAuxiliaresIds: [9],
    });
    const avisos = await listarViaticosRechazadosDelPlan(7, 1, ids);
    expect(avisos).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("5) persona (re)asignada SIN viático rechazado -> el flujo combinado no genera aviso", async () => {
    vi.mocked(query).mockResolvedValue([] as never); // sin filas RECHAZADO para esa persona
    const ids = personalRecienAsignadoDelPlan({
      pilotoCambioReal: true, pilotoFinal: 8, auxiliaresCambioReal: false, auxiliaresFinal: [], antesAuxiliaresIds: [],
    });
    const avisos = await listarViaticosRechazadosDelPlan(7, 1, ids);
    expect(avisos).toEqual([]);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { ESTADOS_ASIGNACION_DIARIA, type RecursoDia } from "./disponibilidad-programacion-dia";
import { normalizarPlanesExcluidos, primerConflictoProgramacionIntervalo } from "./disponibilidad-programacion-intervalos";

/**
 * PR-0 edición rápida — `excluirPlanIds`: el motor de intervalos excluye VARIOS planes (los que un lote reescribe).
 * La BD simulada respeta el `p.id NOT IN (?,…)` que realmente se envía: si el SQL no excluyera, estos tests fallarían.
 */
type Fila = { categoria: "personal" | "unidad" | "tc"; recurso_id: number; nombre: string; plan_id: number; codigo: string; empresa_id: number; estado: string; fecha_plan: string; hora_carga: string | null; regreso_estimado: string | null };
const recurso = (tipo: RecursoDia["tipo"]): RecursoDia => ({ tipo, id: tipo === "unidad" ? 50 : tipo === "tc" ? 60 : 10 });
const ventana = (horaCarga: string | null, regresoEstimado: string | null, fechaPlan = "2026-09-24") => ({ fechaPlan, horaCarga, regresoEstimado });
const VENTANA = ventana("07:00", "2026-09-24T09:00");
const fila = (tipo: RecursoDia["tipo"], planId: number, extras: Partial<Fila> = {}): Fila => ({
  categoria: tipo === "unidad" ? "unidad" : tipo === "tc" ? "tc" : "personal", recurso_id: recurso(tipo).id,
  nombre: tipo === "unidad" ? "C-123" : tipo === "tc" ? "TC-55" : "Juan Pérez", plan_id: planId, codigo: `PLAN-${planId}`,
  empresa_id: 7, estado: "Programado", fecha_plan: "2026-09-24", hora_carga: "05:00", regreso_estimado: "2026-09-24 08:00:00", ...extras,
});

let candidatos: Fila[];
let excluidosEnviados: number[][];
beforeEach(() => {
  vi.clearAllMocks();
  candidatos = [];
  excluidosEnviados = [];
  vi.mocked(query).mockImplementation(async (sql, params) => {
    const texto = String(sql);
    const categoria = texto.includes("FROM tms_personal tp") ? "personal" : texto.includes("FROM tms_unidades u") ? "unidad" : "tc";
    const valores = params as unknown[];
    const marcas = /p\.id NOT IN \(([?,]+)\)/.exec(texto);
    const nExcluidos = marcas ? marcas[1].split(",").length : 0;
    const excluidos = valores.slice(valores.length - nExcluidos) as number[];
    excluidosEnviados.push(excluidos);
    const resto = valores.slice(0, valores.length - nExcluidos);
    const n = ESTADOS_ASIGNACION_DIARIA.length;
    const empresaId = Number(resto[0]);
    const fechaFin = String(resto[1 + n]);
    const fechaInicio = String(resto[2 + n]);
    const inicio = String(resto[3 + n]);
    const ids = resto.slice(categoria === "personal" ? 5 + n : 4 + n).filter((x): x is number => typeof x === "number");
    return candidatos.filter((x) => x.categoria === categoria && x.empresa_id === empresaId
      && x.fecha_plan <= fechaFin && (x.fecha_plan >= fechaInicio || (x.regreso_estimado != null && x.regreso_estimado > inicio))
      && ids.includes(x.recurso_id) && !excluidos.includes(x.plan_id)) as never;
  });
});

const conflicto = (tipo: RecursoDia["tipo"], excluir: readonly number[], v = VENTANA) => primerConflictoProgramacionIntervalo(7, [recurso(tipo)], v, excluir);

describe("normalizarPlanesExcluidos", () => {
  it("deduplica y descarta valores inválidos", () => {
    expect(normalizarPlanesExcluidos([])).toEqual([]);
    expect(normalizarPlanesExcluidos([123, 123, 456, 123])).toEqual([123, 456]);
    expect(normalizarPlanesExcluidos([0, -1, 1.5, Number.NaN, 7])).toEqual([7]);
  });
});

describe.each(["piloto", "auxiliar", "unidad", "tc"] as const)("excluirPlanIds — %s", (tipo) => {
  it("1) lista vacía: no excluye nada y el SQL no lleva NOT IN", async () => {
    candidatos.push(fila(tipo, 123));
    expect((await conflicto(tipo, []))?.planIdConflicto).toBe(123);
    expect(String(vi.mocked(query).mock.calls[0][0])).not.toContain("NOT IN");
  });

  it("2) un id: mismo comportamiento que el antiguo excluirPlanId", async () => {
    candidatos.push(fila(tipo, 123));
    expect(await conflicto(tipo, [123])).toBeNull();
    expect(excluidosEnviados[0]).toEqual([123]);
  });

  it("3) varios ids: ninguno de los planes del conjunto bloquea", async () => {
    candidatos.push(fila(tipo, 123), fila(tipo, 456), fila(tipo, 789));
    expect(await conflicto(tipo, [123, 456, 789])).toBeNull();
    expect(excluidosEnviados[0]).toEqual([123, 456, 789]);
  });

  it("4) ids repetidos: se deduplican antes de parametrizar", async () => {
    candidatos.push(fila(tipo, 123));
    expect(await conflicto(tipo, [123, 123, 123])).toBeNull();
    expect(excluidosEnviados[0]).toEqual([123]);
    expect(String(vi.mocked(query).mock.calls[0][0])).toMatch(/p\.id NOT IN \(\?\)/);
  });

  it("5) un plan FUERA del conjunto sigue bloqueando", async () => {
    candidatos.push(fila(tipo, 123), fila(tipo, 999));
    expect((await conflicto(tipo, [123, 456]))?.planIdConflicto).toBe(999);
  });

  it("6) un plan DENTRO del conjunto no bloquea aunque solape", async () => {
    candidatos.push(fila(tipo, 456));
    expect(await conflicto(tipo, [123, 456])).toBeNull();
  });

  it("10) el cruce de medianoche sigue funcionando con exclusión", async () => {
    candidatos.push(fila(tipo, 123, { fecha_plan: "2026-09-24", hora_carga: "22:00", regreso_estimado: "2026-09-25 02:00:00" }));
    const madrugada = ventana("01:00", "2026-09-25T03:00", "2026-09-25");
    expect((await conflicto(tipo, [456], madrugada))?.planIdConflicto).toBe(123);
    expect(await conflicto(tipo, [123], madrugada)).toBeNull();
    expect(await conflicto(tipo, [], ventana("02:00", "2026-09-25T05:00", "2026-09-25"))).toBeNull(); // fin == inicio: sin solape
  });
});

describe("excluirPlanIds — parametrización y aislamiento", () => {
  it("nunca concatena ids: van como parámetros y el SQL solo lleva marcas ?", async () => {
    await primerConflictoProgramacionIntervalo(7, [recurso("piloto"), recurso("unidad"), recurso("tc")], VENTANA, [11, 22, 33]);
    for (const [sql, params] of vi.mocked(query).mock.calls) {
      expect(String(sql)).toMatch(/p\.id NOT IN \(\?,\?,\?\)/);
      expect(String(sql)).not.toMatch(/NOT IN \([^?)]*\d/);
      expect((params as unknown[]).slice(-3)).toEqual([11, 22, 33]);
    }
  });

  it("personal, unidad y TC usan la MISMA exclusión y conservan empresa_id", async () => {
    await primerConflictoProgramacionIntervalo(7, [recurso("piloto"), recurso("unidad"), recurso("tc")], VENTANA, [5, 6]);
    expect(query).toHaveBeenCalledTimes(3);
    for (const [sql, params] of vi.mocked(query).mock.calls) {
      expect(String(sql)).toContain("p.empresa_id = ?");
      expect((params as unknown[])[0]).toBe(7);
      expect((params as unknown[]).slice(-2)).toEqual([5, 6]);
    }
  });

  it("bajo transacción la exclusión múltiple también usa FOR UPDATE", async () => {
    const conn = { query: vi.fn().mockResolvedValue([[]]) };
    await primerConflictoProgramacionIntervalo(7, [recurso("unidad")], VENTANA, [1, 2], conn as never);
    expect(String(conn.query.mock.calls[0][0])).toMatch(/p\.id NOT IN \(\?,\?\)[\s\S]*FOR UPDATE$/);
    expect(query).not.toHaveBeenCalled();
  });

  it("un plan de otra empresa no se cuela: sigue filtrado por empresa_id", async () => {
    candidatos.push(fila("unidad", 900, { empresa_id: 8 }));
    expect(await conflicto("unidad", [])).toBeNull();
  });
});

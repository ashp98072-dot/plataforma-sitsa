import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), execute: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { cerrarViajesMasivo } from "./cierre-masivo";
import {
  ESTADOS_CIERRE_NORMAL_CON_LLEGADA,
  ESTADOS_CIERRE_NORMAL_SIN_LLEGADA,
  motivoNoCierreManual,
  motivoNoCierreNormal,
  puedeCerrarManualmente,
  puedeCerrarNormalmente,
} from "./cierre-viaje-shared";

/**
 * TMS-CIERRE-MASIVO-1 — el lote se procesa con las funciones REALES del cierre
 * individual (cerrarViaje / cerrarViajeManual de cierre-viaje.ts) sobre una
 * base en memoria; solo se emula el SQL (UPDATE condicional / SELECT ... FOR
 * UPDATE), nunca la lógica de cierre.
 */
type Plan = { id: number; empresa_id: number; codigo: string; estado: string; tipo_viaje: string; cerrado_por?: string; cierre_manual?: number; motivo?: string };
type Flota = { id: number; plan_id: number; empresa_id: number; estado: string };

let planes: Plan[];
let flotas: Flota[];
let fallar: Set<number>;
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };

const plan = (id: number, estado: string, extra: Partial<Plan> = {}): Plan => ({ id, empresa_id: 7, codigo: `PLAN-${id}`, estado, tipo_viaje: "Propio", ...extra });
const llegada = (planId: number, empresa = 7): Flota => ({ id: 900 + planId, plan_id: planId, empresa_id: empresa, estado: "cerrado" });
const tieneLlegada = (p: Plan) => flotas.some((f) => f.plan_id === p.id && f.empresa_id === p.empresa_id && f.estado === "cerrado");
const estados = () => Object.fromEntries(planes.map((p) => [p.id, p.estado]));

const normal = (ids: number[], extra: Partial<Parameters<typeof cerrarViajesMasivo>[0]> = {}) =>
  cerrarViajesMasivo({ empresaId: 7, usuario: "jefe", tipo: "NORMAL", planIds: ids, ...extra });
const manual = (ids: number[], extra: Partial<Parameters<typeof cerrarViajesMasivo>[0]> = {}) =>
  cerrarViajesMasivo({ empresaId: 7, usuario: "jefe", tipo: "MANUAL", planIds: ids, motivo: "Cierre administrativo del día", ...extra });

beforeEach(() => {
  vi.resetAllMocks();
  planes = []; flotas = []; fallar = new Set();
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("p.id IN")) {
      const [emp, ...ids] = params as number[];
      return planes.filter((p) => p.empresa_id === emp && ids.includes(p.id)).map((p) => ({ id: p.id, codigo: p.codigo, estado: p.estado, llegada_registrada: tieneLlegada(p) ? 1 : 0 }));
    }
    if (s.includes("SELECT p.estado")) {
      const [id, emp] = params as number[];
      const p = planes.find((x) => x.id === id && x.empresa_id === emp);
      return p ? [{ estado: p.estado, llegada_registrada: tieneLlegada(p) ? 1 : 0 }] : [];
    }
    if (s.includes("SELECT tipo_viaje")) {
      const [id, emp] = params as number[];
      const p = planes.find((x) => x.id === id && x.empresa_id === emp);
      return p ? [{ tipo_viaje: p.tipo_viaje }] : [];
    }
    throw new Error(`query inesperada: ${s}`);
  }) as never);
  // cerrarViaje() real: UPDATE condicional (misma condición que su SQL).
  vi.mocked(execute).mockImplementation((async (sql: string, params: unknown[]) => {
    const [usuario, id, emp] = params as [string, number, number];
    if (fallar.has(id)) throw new Error("fallo de BD");
    const p = planes.find((x) => x.id === id && x.empresa_id === emp);
    const ok = p && (p.estado === "Descargado" || (["En ruta", "Cargado"].includes(p.estado) && tieneLlegada(p)));
    if (!ok) return { affectedRows: 0 };
    p.estado = "Cerrado"; p.cerrado_por = usuario;
    return { affectedRows: 1 };
  }) as never);
  // cerrarViajeManual() real: transacción por viaje.
  conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("FROM tms_planes_viaje")) { const p = planes.find((x) => x.id === params[0] && x.empresa_id === params[1]); return [p ? [p] : []]; }
    if (s.includes("FROM flota_viajes")) { const f = flotas.filter((x) => x.plan_id === params[0]).at(-1); return [f ? [f] : []]; }
    throw new Error(`conn.query inesperada: ${s}`);
  });
  conn.execute.mockImplementation(async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("UPDATE flota_viajes")) return [{ affectedRows: 1 }];
    if (s.includes("UPDATE tms_planes_viaje")) {
      const [usuario, motivo, , id, emp] = params as [string, string, string | null, number, number];
      if (fallar.has(id)) throw new Error("fallo de BD");
      const p = planes.find((x) => x.id === id && x.empresa_id === emp && ["Programado", "Cargado", "En ruta"].includes(x.estado));
      if (!p) return [{ affectedRows: 0 }];
      Object.assign(p, { estado: "Cerrado", cerrado_por: usuario, cierre_manual: 1, motivo });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`conn.execute inesperado: ${s}`);
  });
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
});

describe("helper de elegibilidad NORMAL (UI y backend comparten el criterio)", () => {
  it("Descargado sí (con o sin llegada); En ruta/Cargado solo con llegada; Programado, Cerrado y Cancelado nunca", () => {
    expect(puedeCerrarNormalmente("Descargado", false)).toBe(true);
    expect(puedeCerrarNormalmente("Descargado", true)).toBe(true);
    for (const e of ["En ruta", "Cargado"]) {
      expect(puedeCerrarNormalmente(e, true)).toBe(true);
      expect(puedeCerrarNormalmente(e, false)).toBe(false);
    }
    for (const e of ["Programado", "Cerrado", "Cancelado"]) {
      expect(puedeCerrarNormalmente(e, true)).toBe(false);
      expect(puedeCerrarNormalmente(e, false)).toBe(false);
    }
  });

  it("manual: Programado/Cargado/En ruta sí; Descargado, Cerrado y Cancelado no", () => {
    for (const e of ["Programado", "Cargado", "En ruta"]) expect(puedeCerrarManualmente(e)).toBe(true);
    for (const e of ["Descargado", "Cerrado", "Cancelado"]) expect(puedeCerrarManualmente(e)).toBe(false);
  });

  it("los motivos legibles solo existen cuando NO procede", () => {
    expect(motivoNoCierreNormal("Descargado", false)).toBeNull();
    expect(motivoNoCierreNormal("En ruta", false)).toContain("no ha registrado la llegada");
    expect(motivoNoCierreNormal("Cerrado", true)).toContain("ya fue cerrado");
    expect(motivoNoCierreNormal("Cancelado", true)).toContain("cancelado");
    expect(motivoNoCierreManual("Programado")).toBeNull();
    expect(motivoNoCierreManual("Descargado")).toContain("no admite cierre manual");
  });

  it("no diverge del backend: el UPDATE de cerrarViaje() usa exactamente esos estados", () => {
    const sql = readFileSync("src/lib/tms/cierre-viaje.ts", "utf8");
    for (const e of ESTADOS_CIERRE_NORMAL_SIN_LLEGADA) expect(sql).toContain(`p.estado = '${e}'`);
    expect(sql).toContain(`p.estado IN (${ESTADOS_CIERRE_NORMAL_CON_LLEGADA.map((e) => `'${e}'`).join(", ")})`);
  });
});

describe("cierre masivo NORMAL — reutiliza cerrarViaje() real", () => {
  it("mezcla de estados: cierra Descargado y En ruta/Cargado con llegada; omite Programado, sin llegada, Cerrado y Cancelado con su motivo", async () => {
    planes = [plan(1, "Descargado"), plan(2, "En ruta"), plan(3, "Cargado"), plan(4, "Programado"), plan(5, "En ruta"), plan(6, "Cerrado"), plan(7, "Cancelado")];
    flotas = [llegada(2), llegada(3), llegada(4)]; // 4: Programado CON llegada (el listado lo marca pendiente; el backend lo rechaza)
    const r = await normal([1, 2, 3, 4, 5, 6, 7]);
    expect(r.cerrados.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(r.omitidos.map((o) => o.id)).toEqual([4, 5, 6, 7]);
    expect(r.errores).toEqual([]);
    expect(r.omitidos.find((o) => o.id === 5)!.motivo).toContain("no ha registrado la llegada");
    expect(estados()).toEqual({ 1: "Cerrado", 2: "Cerrado", 3: "Cerrado", 4: "Programado", 5: "En ruta", 6: "Cerrado", 7: "Cancelado" });
    // Se ejecutó la función real: UPDATE condicional de cerrarViaje, una vez por elegible, nunca para los omitidos.
    const ids = vi.mocked(execute).mock.calls.map(([, p]) => (p as number[])[1]);
    expect(ids).toEqual([1, 2, 3]);
    expect(String(vi.mocked(execute).mock.calls[0][0])).toContain("UPDATE tms_planes_viaje p");
  });

  it("ids duplicados se cierran UNA sola vez y se cuentan una vez", async () => {
    planes = [plan(1, "Descargado")];
    const r = await normal([1, 1, 1]);
    expect(r.solicitados).toBe(1);
    expect(r.cerrados).toHaveLength(1);
    expect(vi.mocked(execute)).toHaveBeenCalledTimes(1);
  });

  it("tenant: un id de OTRA empresa o inexistente no se toca y se reporta como no encontrado", async () => {
    planes = [plan(1, "Descargado"), plan(2, "Descargado", { empresa_id: 8 })];
    const r = await normal([1, 2, 999]);
    expect(r.cerrados.map((c) => c.id)).toEqual([1]);
    expect(r.omitidos).toEqual([{ id: 2, codigo: "—", motivo: "Viaje no encontrado." }, { id: 999, codigo: "—", motivo: "Viaje no encontrado." }]);
    expect(planes[1].estado).toBe("Descargado");
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7, 1, 2, 999]); // empresa de la sesión primero
    expect(vi.mocked(execute).mock.calls.every(([, p]) => (p as number[])[2] === 7)).toBe(true);
  });

  it("un viaje que FALLA no impide cerrar los demás y no revierte los cierres ya hechos", async () => {
    planes = [plan(1, "Descargado"), plan(2, "Descargado"), plan(3, "Descargado")];
    fallar = new Set([2]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await normal([1, 2, 3]);
    expect(r.cerrados.map((c) => c.id)).toEqual([1, 3]);
    expect(r.errores).toEqual([{ id: 2, codigo: "PLAN-2", motivo: "Error inesperado al cerrar este viaje." }]);
    expect(estados()).toEqual({ 1: "Cerrado", 2: "Descargado", 3: "Cerrado" });
  });

  it("si el servicio lo rechaza en el último instante (cambió de estado) queda como omitido, no como error", async () => {
    planes = [plan(1, "Descargado")];
    const original = vi.mocked(query).getMockImplementation() as unknown as (sql: string, params: unknown[]) => Promise<unknown>;
    let primera = true;
    vi.mocked(query).mockImplementation(((sql: string, params: unknown[]) => {
      if (primera && String(sql).includes("p.id IN")) { primera = false; const r = original(sql, params); planes[0].estado = "Cerrado"; return r; }
      return original(sql, params);
    }) as never);
    const r = await normal([1]);
    expect(r.cerrados).toEqual([]);
    expect(r.omitidos).toEqual([expect.objectContaining({ id: 1, motivo: "Este viaje ya fue cerrado." })]);
  });

  it("auditoría: cada viaje cerrado conserva su auditoría individual y se agrega UN resumen cierre_masivo_viajes", async () => {
    planes = [plan(1, "Descargado"), plan(2, "Programado")];
    await normal([1, 2], { grupo: "2026-09-23" });
    const llamadas = vi.mocked(registrarAuditoria).mock.calls.map(([a]) => a);
    expect(llamadas.filter((a) => a.accion === "cerrar_viaje")).toHaveLength(1);
    const resumen = llamadas.filter((a) => a.accion === "cierre_masivo_viajes");
    expect(resumen).toHaveLength(1);
    expect(resumen[0]).toMatchObject({ empresaId: 7, usuario: "jefe", modulo: "tms" });
    expect(resumen[0].detalle).toContain("NORMAL");
    expect(resumen[0].detalle).toContain("grupo 2026-09-23");
    expect(resumen[0].detalle).toContain("solicitados 2 · cerrados 1 · omitidos 1 · errores 0");
    expect(resumen[0].detalle).not.toContain("motivo común");
  });

  it("sin ids válidos no consulta ni cierra nada", async () => {
    const r = await normal([]);
    expect(r).toMatchObject({ solicitados: 0, cerrados: [], omitidos: [], errores: [] });
    expect(vi.mocked(query)).not.toHaveBeenCalled();
    expect(vi.mocked(execute)).not.toHaveBeenCalled();
  });
});

describe("cierre masivo MANUAL — reutiliza cerrarViajeManual() real con motivo común", () => {
  it("cierra Programado/Cargado/En ruta (con o sin llegada); omite Descargado, Cerrado y Cancelado", async () => {
    planes = [plan(1, "Programado"), plan(2, "Cargado"), plan(3, "En ruta"), plan(4, "Descargado"), plan(5, "Cerrado"), plan(6, "Cancelado")];
    const r = await manual([1, 2, 3, 4, 5, 6], { comentario: "Regularización de fin de semana" });
    expect(r.cerrados.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(r.omitidos.map((o) => o.id)).toEqual([4, 5, 6]);
    expect(r.omitidos.find((o) => o.id === 4)!.motivo).toContain("no admite cierre manual");
    for (const id of [1, 2, 3]) expect(planes.find((p) => p.id === id)).toMatchObject({ estado: "Cerrado", cierre_manual: 1, motivo: "Cierre administrativo del día" });
    expect(estados()[4]).toBe("Descargado");
  });

  it("el MISMO motivo/comentario se aplica a cada viaje y cada uno conserva su auditoría individual (cerrar_viaje_manual)", async () => {
    planes = [plan(1, "Programado"), plan(2, "En ruta")];
    await manual([1, 2], { comentario: "Común" });
    const individuales = vi.mocked(registrarAuditoriaTx).mock.calls.map(([, a]) => a);
    expect(individuales).toHaveLength(2);
    for (const a of individuales) {
      expect(a.accion).toBe("cerrar_viaje_manual");
      expect(a.detalle).toContain("Motivo: Cierre administrativo del día");
      expect(a.detalle).toContain("Comentario: Común");
    }
    const resumen = vi.mocked(registrarAuditoria).mock.calls.map(([a]) => a).filter((a) => a.accion === "cierre_masivo_viajes");
    expect(resumen).toHaveLength(1);
    expect(resumen[0].detalle).toContain("MANUAL");
    expect(resumen[0].detalle).toContain("motivo común: Cierre administrativo del día");
    expect(resumen[0].detalle).toContain("comentario: Común");
  });

  it("no inventa llegada/km/evidencias: no se crea ninguna fila de flota_viajes", async () => {
    planes = [plan(1, "Programado")];
    await manual([1]);
    expect(conn.execute.mock.calls.some(([sql]) => /INSERT INTO (flota_viajes|tms_evidencias)/.test(String(sql)))).toBe(false);
    expect(conn.execute.mock.calls.some(([sql]) => /km_llegada|hora_llegada/.test(String(sql)))).toBe(false);
  });

  it("motivo inválido (corto) lo rechaza el servicio real por viaje: nada se cierra", async () => {
    planes = [plan(1, "Programado")];
    const r = await manual([1], { motivo: "abc" });
    expect(r.cerrados).toEqual([]);
    expect(r.omitidos[0].motivo).toContain("al menos 5 caracteres");
    expect(planes[0].estado).toBe("Programado");
  });

  it("un viaje que falla hace rollback SOLO de sí mismo; los demás siguen y los anteriores no se revierten", async () => {
    planes = [plan(1, "Programado"), plan(2, "Programado"), plan(3, "Programado")];
    fallar = new Set([2]);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await manual([1, 2, 3]);
    expect(r.cerrados.map((c) => c.id)).toEqual([1, 3]);
    expect(r.errores.map((e) => e.id)).toEqual([2]);
    expect(estados()).toEqual({ 1: "Cerrado", 2: "Programado", 3: "Cerrado" });
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).toHaveBeenCalledTimes(2);
  });

  it("tenant: otra empresa no se cierra y ninguna consulta usa un empresa_id distinto al de la sesión", async () => {
    planes = [plan(1, "Programado", { empresa_id: 8 }), plan(2, "Programado")];
    const r = await manual([1, 2]);
    expect(r.cerrados.map((c) => c.id)).toEqual([2]);
    expect(planes[0].estado).toBe("Programado");
  });
});

describe("garantías estructurales", () => {
  it("cierre-masivo.ts no reimplementa el cierre: usa cerrarViaje/cerrarViajeManual y no escribe planes/flota por su cuenta", () => {
    const src = readFileSync("src/lib/tms/cierre-masivo.ts", "utf8");
    expect(src).toContain("cerrarViaje(opts.empresaId, id, opts.usuario)");
    expect(src).toContain("cerrarViajeManual({");
    expect(src).not.toMatch(/UPDATE\s+tms_planes_viaje|UPDATE\s+flota_viajes|beginTransaction/);
  });
});

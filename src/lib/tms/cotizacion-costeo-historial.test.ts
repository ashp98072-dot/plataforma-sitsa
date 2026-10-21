import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ErrorSeleccionCosteo, MENSAJE_COSTEO_NO_ENCONTRADO, MENSAJE_SELECCION_SOLO_BORRADOR, seleccionarCosteo } from "./cotizacion-costeo-historial";

type Fila = { id: number; empresa_id: number; cotizacion_id: number; version: number; es_seleccionado: number; seleccionado_por: string | null; seleccionado_en: string | null };

/**
 * Base simulada con la semántica de las tablas reales: cotizaciones (empresa_id, id, estado) y costeos (empresa_id, cotizacion_id, id, version,
 * es_seleccionado). Interpreta SOLO las sentencias que el módulo ejecuta y respeta sus filtros de empresa/cotización: si el código omitiera un
 * filtro, los tests de aislamiento fallarían.
 */
function base(opts: { estado?: string; costeos?: Partial<Fila>[] } = {}) {
  const cotizaciones = [{ id: 10, empresa_id: 1, codigo: "COT-000010", estado: opts.estado ?? "Borrador" }, { id: 20, empresa_id: 2, codigo: "COT-000020", estado: "Borrador" }];
  const costeos: Fila[] = (opts.costeos ?? [
    { id: 55, version: 1, es_seleccionado: 1 }, { id: 56, version: 2, es_seleccionado: 0 }, { id: 57, version: 3, es_seleccionado: 0 },
  ]).map((c) => ({ empresa_id: 1, cotizacion_id: 10, seleccionado_por: null, seleccionado_en: null, ...c })) as Fila[];
  // Costeo de OTRA cotización de la misma empresa y de OTRA empresa: nunca deben poder seleccionarse desde la cotización 10 / empresa 1.
  costeos.push({ id: 90, empresa_id: 1, cotizacion_id: 11, version: 1, es_seleccionado: 1, seleccionado_por: null, seleccionado_en: null });
  costeos.push({ id: 91, empresa_id: 2, cotizacion_id: 20, version: 1, es_seleccionado: 1, seleccionado_por: null, seleccionado_en: null });
  const log: string[] = [];
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, p: unknown[]) => {
      log.push(sql);
      if (sql.includes("FROM tms_cotizaciones")) return [cotizaciones.filter((c) => c.empresa_id === p[0] && c.id === p[1])];
      if (sql.includes("FROM tms_cotizacion_costeos")) return [costeos.filter((c) => c.empresa_id === p[0] && c.cotizacion_id === p[1]).map((c) => ({ ...c }))];
      return [[]];
    }),
    execute: vi.fn(async (sql: string, p: unknown[]) => {
      log.push(sql);
      if (/SET es_seleccionado = 0/.test(sql)) {
        for (const c of costeos) if (c.empresa_id === p[0] && c.cotizacion_id === p[1] && c.es_seleccionado === 1 && c.id !== p[2]) Object.assign(c, { es_seleccionado: 0, seleccionado_por: null, seleccionado_en: null });
      } else if (/SET es_seleccionado = 1/.test(sql)) {
        for (const c of costeos) if (c.empresa_id === p[1] && c.cotizacion_id === p[2] && c.id === p[3]) Object.assign(c, { es_seleccionado: 1, seleccionado_por: p[0] as string, seleccionado_en: "ahora" });
      }
      return [{ affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return { conn, costeos, log, seleccionados: (emp = 1, cot = 10) => costeos.filter((c) => c.empresa_id === emp && c.cotizacion_id === cot && c.es_seleccionado === 1).map((c) => c.id) };
}

beforeEach(() => vi.resetAllMocks());

describe("seleccionarCosteo: «Usar este costeo»", () => {
  it("v1 seleccionada, se elige la v3: queda SOLO la v3 seleccionada (con quién y cuándo) y se audita sin importes", async () => {
    const b = base();
    const r = await seleccionarCosteo(1, 10, 57, "admin");
    expect(r).toEqual({ costeoId: 57, version: 3, cambio: true });
    expect(b.seleccionados()).toEqual([57]);
    expect(b.costeos.find((c) => c.id === 57)).toMatchObject({ es_seleccionado: 1, seleccionado_por: "admin" });
    expect(b.costeos.find((c) => c.id === 55)).toMatchObject({ es_seleccionado: 0, seleccionado_por: null, seleccionado_en: null });
    expect(b.conn.commit).toHaveBeenCalledOnce(); expect(b.conn.rollback).not.toHaveBeenCalled(); expect(b.conn.release).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).toHaveBeenCalledOnce();
    expect(vi.mocked(registrarAuditoriaTx).mock.calls[0][1]).toEqual({ empresaId: 1, usuario: "admin", accion: "seleccionar_costeo", modulo: "tms_cotizaciones", detalle: "Costeo interno versión 3 seleccionado para cotización COT-000010." });
  });
  it("seleccionar la v1 DESPUÉS de la v3 funciona (se puede volver atrás) y sigue habiendo una sola seleccionada", async () => {
    const b = base();
    await seleccionarCosteo(1, 10, 57, "admin");
    const r = await seleccionarCosteo(1, 10, 55, "ana");
    expect(r).toMatchObject({ costeoId: 55, version: 1, cambio: true });
    expect(b.seleccionados()).toEqual([55]);
    expect(b.costeos.find((c) => c.id === 55)).toMatchObject({ seleccionado_por: "ana" });
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(2);
  });
  it("transacción segura: bloquea la cotización padre y TODAS sus versiones (FOR UPDATE, por empresa_id + cotizacion_id) antes de mover la marca", async () => {
    const b = base();
    await seleccionarCosteo(1, 10, 56, "admin");
    expect(b.conn.beginTransaction).toHaveBeenCalledOnce();
    const consultas = b.conn.query.mock.calls as unknown as [string, unknown[]][];
    expect(consultas[0][0]).toContain("FROM tms_cotizaciones WHERE empresa_id = ? AND id = ?"); expect(consultas[0][0]).toContain("FOR UPDATE"); expect(consultas[0][1]).toEqual([1, 10]);
    expect(consultas[1][0]).toContain("FROM tms_cotizacion_costeos WHERE empresa_id = ? AND cotizacion_id = ?"); expect(consultas[1][0]).toContain("FOR UPDATE"); expect(consultas[1][1]).toEqual([1, 10]);
    const iBloqueo = b.log.findIndex((q) => q.includes("FROM tms_cotizacion_costeos"));
    const iUpdate = b.log.findIndex((q) => /^UPDATE/.test(q));
    expect(iBloqueo).toBeGreaterThanOrEqual(0); expect(iUpdate).toBeGreaterThan(iBloqueo);
    // Todos los UPDATE llevan empresa_id y cotizacion_id.
    for (const [sql] of b.conn.execute.mock.calls as unknown as [string][]) { expect(sql).toContain("empresa_id = ?"); expect(sql).toContain("cotizacion_id = ?"); }
  });
  it("solo se escribe la marca de selección: jamás los snapshots, importes ni componentes (las versiones son inmutables)", async () => {
    const b = base();
    await seleccionarCosteo(1, 10, 56, "admin");
    for (const [sql] of b.conn.execute.mock.calls as unknown as [string][]) {
      expect(sql).toMatch(/^UPDATE tms_cotizacion_costeos SET es_seleccionado = [01]/);
      expect(sql).not.toMatch(/snapshot|costo_|precio_|margen_|iva|motor_version|perfil_|DELETE|INSERT/i);
    }
    const fuente = readFileSync("src/lib/tms/cotizacion-costeo-historial.ts", "utf8");
    expect(fuente).not.toMatch(/tms_cotizacion_costeo_componentes/);
  });
  it("idempotente: elegir la que ya es la única seleccionada no escribe ni audita", async () => {
    const b = base();
    const r = await seleccionarCosteo(1, 10, 55, "admin");
    expect(r).toEqual({ costeoId: 55, version: 1, cambio: false });
    expect(b.conn.execute).not.toHaveBeenCalled(); expect(registrarAuditoriaTx).not.toHaveBeenCalled(); expect(b.conn.commit).toHaveBeenCalledOnce();
  });
  it("repara un dato anómalo con DOS seleccionadas: queda solo la elegida", async () => {
    const b = base({ costeos: [{ id: 55, version: 1, es_seleccionado: 1 }, { id: 56, version: 2, es_seleccionado: 1 }] });
    await seleccionarCosteo(1, 10, 56, "admin");
    expect(b.seleccionados()).toEqual([56]);
  });
  it("TENANT: un costeo de OTRA empresa (id 91) no puede seleccionarse con la empresa 1 => 404, sin escribir", async () => {
    const b = base();
    await expect(seleccionarCosteo(1, 10, 91, "admin")).rejects.toMatchObject({ name: "ErrorSeleccionCosteo", status: 404, message: MENSAJE_COSTEO_NO_ENCONTRADO });
    expect(b.conn.execute).not.toHaveBeenCalled(); expect(b.conn.rollback).toHaveBeenCalledOnce(); expect(b.conn.commit).not.toHaveBeenCalled();
    expect(b.seleccionados()).toEqual([55]); expect(b.seleccionados(2, 20)).toEqual([91]);
  });
  it("TENANT: la cotización de otra empresa no existe para esta (404) aunque el costeoId sea válido", async () => {
    const b = base();
    await expect(seleccionarCosteo(1, 20, 91, "admin")).rejects.toMatchObject({ status: 404 });
    await expect(seleccionarCosteo(2, 10, 55, "admin")).rejects.toMatchObject({ status: 404 });
    expect(b.conn.execute).not.toHaveBeenCalled();
  });
  it("un costeo de OTRA cotización (misma empresa, id 90) no puede seleccionarse desde esta cotización => 404, y la otra conserva su selección", async () => {
    const b = base();
    await expect(seleccionarCosteo(1, 10, 90, "admin")).rejects.toMatchObject({ status: 404, message: MENSAJE_COSTEO_NO_ENCONTRADO });
    expect(b.conn.execute).not.toHaveBeenCalled();
    expect(b.seleccionados(1, 11)).toEqual([90]); expect(b.seleccionados()).toEqual([55]);
  });
  it("una cotización que ya no es Borrador no cambia su costeo utilizado => 409, sin escribir (el historial sí se puede consultar)", async () => {
    const b = base({ estado: "Enviada" });
    await expect(seleccionarCosteo(1, 10, 56, "admin")).rejects.toMatchObject({ status: 409, message: MENSAJE_SELECCION_SOLO_BORRADOR });
    expect(b.conn.execute).not.toHaveBeenCalled(); expect(b.conn.rollback).toHaveBeenCalledOnce(); expect(b.seleccionados()).toEqual([55]);
  });
  it("un fallo a mitad de la escritura revierte la transacción (no queda sin seleccionada ni con dos)", async () => {
    const b = base();
    b.conn.execute.mockImplementationOnce(async () => [{ affectedRows: 1 }]).mockImplementationOnce(async () => { throw new Error("se cayó la conexión"); });
    await expect(seleccionarCosteo(1, 10, 56, "admin")).rejects.toThrow("se cayó la conexión");
    expect(b.conn.rollback).toHaveBeenCalledOnce(); expect(b.conn.commit).not.toHaveBeenCalled(); expect(b.conn.release).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
  it("ErrorSeleccionCosteo expone el status HTTP", () => {
    const e = new ErrorSeleccionCosteo("x", 409);
    expect(e).toBeInstanceOf(Error); expect(e.status).toBe(409);
  });
});

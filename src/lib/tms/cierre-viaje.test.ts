import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), execute: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));

import { getPool } from "@/lib/db";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { cerrarViaje, cerrarViajeManual, puedeCerrarManualmente } from "./cierre-viaje";

/**
 * TMS-CIERRE-OPERACIONES-1 — cerrarViajeManual(). Mismo arnés de mocks ya
 * usado en src/lib/admin/*.test.ts (conn con query/execute/beginTransaction/
 * commit/rollback/release, todos vi.fn()).
 */

const conn = {
  query: vi.fn(),
  execute: vi.fn(),
  beginTransaction: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const db = conn as unknown as PoolConnection;

let plan: Record<string, unknown> | undefined;
let flota: Record<string, unknown> | undefined;
let planUpdateAffectedRows: number;
/** Fila de tms_viaje_liquidaciones del plan; por defecto REPORTE_RECIBIDO (requisito del cierre). undefined = sin fila. */
let liquidacion: { estado: string } | undefined;
/** Si es un número, la consulta a tms_viaje_liquidaciones lanza ese errno (p. ej. 1146 = tabla ausente). */
let errnoLiquidacion: number | undefined;
/** ¿Existe el evento append-only REPORTE_RECIBIDO del plan? (evidencia histórica de planes heredados). */
let eventoReporte: boolean;

function cerrar(overrides: Partial<Parameters<typeof cerrarViajeManual>[0]> = {}) {
  return cerrarViajeManual({
    empresaId: 7,
    planId: 10,
    usuario: "jefe.operaciones",
    motivo: "Cambio operativo: se reasignó la unidad y el piloto no completó el flujo del portal.",
    ...overrides,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
  flota = undefined;
  planUpdateAffectedRows = 1;
  liquidacion = { estado: "REPORTE_RECIBIDO" };
  errnoLiquidacion = undefined;
  eventoReporte = false;

  conn.query.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("FROM tms_viaje_liquidacion_eventos")) return [eventoReporte ? [{ hay: 1 }] : []];
    if (s.includes("FROM tms_viaje_liquidaciones")) {
      if (errnoLiquidacion) throw Object.assign(new Error("tabla ausente"), { errno: errnoLiquidacion });
      return [liquidacion ? [liquidacion] : []];
    }
    if (s.includes("FROM tms_planes_viaje")) return [plan ? [plan] : []];
    if (s.includes("FROM flota_viajes")) return [flota ? [flota] : []];
    throw new Error(`Consulta inesperada: ${s}`);
  });
  conn.execute.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (s.includes("UPDATE tms_planes_viaje")) return [{ affectedRows: planUpdateAffectedRows }];
    if (s.includes("UPDATE flota_viajes")) return [{ affectedRows: 1 }];
    throw new Error(`Execute inesperado: ${s}`);
  });
  vi.mocked(getPool).mockReturnValue({
    getConnection: vi.fn().mockResolvedValue(db),
  } as unknown as ReturnType<typeof getPool>);
});

describe("cerrarViajeManual — casos por estado", () => {
  it("1) Programado sin flota_viajes se puede cerrar manualmente", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    flota = undefined;
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("2) no se crea ninguna fila sintética en flota_viajes cuando no existe ninguna", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    flota = undefined;
    await cerrar();
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO flota_viajes"))).toBe(false);
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE flota_viajes"))).toBe(false);
  });

  it("3) Cargado se puede cerrar manualmente", async () => {
    plan = { id: 10, estado: "Cargado", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r.ok).toBe(true);
  });

  it("4) En ruta se puede cerrar manualmente", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r.ok).toBe(true);
  });

  it("5) Cerrado no se puede volver a cerrar", async () => {
    plan = { id: 10, estado: "Cerrado", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r).toEqual({ ok: false, error: "Este viaje ya fue cerrado." });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("6) Cancelado no se puede cerrar", async () => {
    plan = { id: 10, estado: "Cancelado", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r).toEqual({ ok: false, error: "Este viaje está cancelado; no admite cierre manual." });
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("Descargado (legado) tampoco admite cierre manual (no está en la lista permitida)", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r.ok).toBe(false);
  });

  it("8) otra empresa: el plan no aparece (WHERE empresa_id) → 'Viaje no encontrado', nunca se filtra info de otro tenant", async () => {
    plan = undefined; // simula que el plan no pertenece a empresaId=7
    const r = await cerrar();
    expect(r).toEqual({ ok: false, error: "Viaje no encontrado." });
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
});

/**
 * PLANES-TARIFA-CIERRE-1 — "manual" significa que puede omitirse la llegada física, NUNCA que puede
 * omitirse el requisito financiero. La tarifa se valida ANTES de tocar flota_viajes o el plan (nunca cierra
 * flota_viajes primero y luego descubre que falta tarifa). Tests 13-17 del ticket.
 */
describe("cerrarViajeManual — exige tarifa_comercial (PLANES-TARIFA-CIERRE-1)", () => {
  it("13) Programado CON tarifa -> puede cerrar manualmente (camino feliz, ya cubierto arriba con tarifa_comercial: 500 por defecto)", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
  });

  it("14) Programado SIN tarifa (null) -> NO cierra, mensaje específico", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: null };
    const r = await cerrar();
    expect(r).toEqual({ ok: false, error: "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada." });
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("15) sin tarifa: NUNCA toca flota_viajes (la validación de tarifa ocurre ANTES de cualquier escritura)", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: null };
    flota = { id: 55, estado: "abierto" }; // existe un flota_viajes abierto — NO debe tocarse
    await cerrar();
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE flota_viajes"))).toBe(false);
  });

  it("16) el UPDATE final del plan tiene defensa concurrente 'tarifa_comercial IS NOT NULL' además de estado IN (...)", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    await cerrar();
    const upd = conn.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE tms_planes_viaje"))!;
    expect(String(upd[0])).toContain("tarifa_comercial IS NOT NULL");
    expect(String(upd[0])).toContain("estado IN ('Programado', 'Cargado', 'En ruta')");
  });

  it("17) Q0.00 (tarifa_comercial = 0, NO null) SÍ permite cierre manual", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 0 };
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
  });

  it("carrera: la tarifa desaparece entre la lectura inicial (FOR UPDATE) y el UPDATE final -> el UPDATE defensivo no afecta filas, se informa sin excepción", async () => {
    // La lectura inicial SÍ tiene tarifa (pasa la validación temprana) pero el UPDATE final, con su propia
    // defensa `tarifa_comercial IS NOT NULL`, no encuentra la fila (simulando que cambió justo antes).
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    planUpdateAffectedRows = 0;
    const r = await cerrar();
    expect(r).toEqual({ ok: false, error: "El viaje cambió de estado durante la operación. Vuelve a intentarlo." });
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
});

describe("cerrarViajeManual — validación de motivo/comentario", () => {
  it("9) motivo vacío bloqueado, sin tocar la BD", async () => {
    const r = await cerrar({ motivo: "" });
    expect(r).toEqual({ ok: false, error: "El motivo debe tener al menos 5 caracteres." });
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("10) motivo con menos de 5 caracteres (tras trim) bloqueado", async () => {
    const r = await cerrar({ motivo: "  ab  " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("al menos 5");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("11) motivo de más de 500 caracteres bloqueado", async () => {
    const r = await cerrar({ motivo: "x".repeat(501) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("500 caracteres");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("motivo de exactamente 500 caracteres SÍ se acepta (límite inclusivo)", async () => {
    const r = await cerrar({ motivo: "x".repeat(500) });
    expect(r.ok).toBe(true);
  });

  it("12) comentario de más de 1000 caracteres bloqueado", async () => {
    const r = await cerrar({ comentario: "y".repeat(1001) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("1000 caracteres");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
  });

  it("comentario de exactamente 1000 caracteres SÍ se acepta", async () => {
    const r = await cerrar({ comentario: "y".repeat(1000) });
    expect(r.ok).toBe(true);
  });

  it("comentario ausente/null es válido (opcional)", async () => {
    const r = await cerrar({ comentario: null });
    expect(r.ok).toBe(true);
  });
});

describe("cerrarViajeManual — metadatos de cierre grabados (13-16)", () => {
  it("13/14/15/16) graba usuario, motivo y comentario en el UPDATE de tms_planes_viaje; cerrado_en usa NOW()", async () => {
    await cerrar({ usuario: "jefe.ops", motivo: "Cambio operativo confirmado por Gerencia.", comentario: "Unidad reasignada a otra ruta urgente." });
    const [sql, params] = conn.execute.mock.calls.find(([s]) => String(s).includes("UPDATE tms_planes_viaje"))!;
    expect(String(sql)).toContain("cierre_manual = 1");
    expect(String(sql)).toContain("cierre_manual_motivo = ?");
    expect(String(sql)).toContain("cierre_manual_comentario = ?");
    expect(String(sql)).toContain("cerrado_por = ?");
    expect(String(sql)).toContain("cerrado_en = NOW()");
    expect(params).toEqual([
      "jefe.ops",
      "Cambio operativo confirmado por Gerencia.",
      "Unidad reasignada a otra ruta urgente.",
      10,
      7,
    ]);
  });
});

describe("cerrarViajeManual — auditoría (17)", () => {
  it("17) registra auditoría con empresa, usuario, acción, motivo y estado anterior", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    await cerrar({ motivo: "Piloto dejó de responder; unidad reasignada." });
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        empresaId: 7,
        usuario: "jefe.operaciones",
        accion: "cerrar_viaje_manual",
        modulo: "tms",
      }),
    );
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("Plan #10 →");
    expect(detalle.detalle).toContain("CIERRE MANUAL POR OPERACIONES");
    expect(detalle.detalle).toContain("Estado anterior: En ruta");
    expect(detalle.detalle).toContain("Piloto dejó de responder; unidad reasignada.");
  });

  it("auditoría del caso crítico incluye 'SIN VIAJE FÍSICO REGISTRADO' cuando no hay flota_viajes", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    flota = undefined;
    await cerrar();
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("SIN VIAJE FÍSICO REGISTRADO");
  });

  /**
   * PROGRAMACION-VIAJES-TERCERIZADOS-1 (sección 22) — el cierre manual
   * ahora también registra tipo_viaje en la auditoría; ser Tercerizado
   * nunca cambia si el cierre procede (sección 19).
   */
  it("registra tipo_viaje = Tercerizado en la auditoría cuando el plan lo es", async () => {
    plan = { id: 10, estado: "Programado", tipo_viaje: "Tercerizado", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r.ok).toBe(true);
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("Tipo: Tercerizado");
  });

  it("un plan sin tipo_viaje en la fila (dato legado) audita como Propio, nunca revienta", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    const r = await cerrar();
    expect(r.ok).toBe(true);
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("Tipo: Propio");
  });
});

describe("cerrarViajeManual — flota_viajes huérfano (18-21)", () => {
  it("18) si existe flota_viajes 'abierto', queda 'cerrado'", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "abierto" };
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: true });
    const [sql, params] = conn.execute.mock.calls.find(([s]) => String(s).includes("UPDATE flota_viajes"))!;
    expect(String(sql)).toContain("estado = 'cerrado'");
    expect(params).toEqual([55, 7]);
  });

  it("19) nunca escribe km_llegada/km_salida — no se fabrican kilómetros", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "abierto" };
    await cerrar();
    const [sql] = conn.execute.mock.calls.find(([s]) => String(s).includes("UPDATE flota_viajes"))!;
    expect(String(sql)).not.toMatch(/km_llegada\s*=\s*\?/);
    expect(String(sql)).not.toMatch(/km_salida\s*=\s*\?/);
  });

  it("20) nunca escribe coordenadas (latitud/longitud) — no se fabrica ubicación", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "abierto" };
    await cerrar();
    const [sql] = conn.execute.mock.calls.find(([s]) => String(s).includes("UPDATE flota_viajes"))!;
    expect(String(sql)).not.toMatch(/latitud|longitud/i);
  });

  it("21) no se crea ninguna evidencia (tms_evidencias/flota_viaje_evidencias) durante el cierre manual", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "abierto" };
    await cerrar();
    const todas = [...conn.query.mock.calls, ...conn.execute.mock.calls].map(([s]) => String(s));
    expect(todas.some((s) => s.includes("tms_evidencias") || s.includes("flota_viaje_evidencias") || s.includes("flota_lecturas"))).toBe(false);
  });

  it("un flota_viajes ya 'cerrado' (llegada real ya registrada) NO se vuelve a tocar", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "cerrado" };
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
    expect(conn.execute.mock.calls.some(([s]) => String(s).includes("UPDATE flota_viajes"))).toBe(false);
  });
});

describe("cerrarViajeManual — transacción y errores (22)", () => {
  it("22) un error durante el cierre hace rollback completo, nunca commit", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "abierto" };
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("UPDATE flota_viajes")) throw new Error("fallo de conexión simulado");
      return [{ affectedRows: 1 }];
    });
    await expect(cerrar()).rejects.toThrow("fallo de conexión simulado");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("22b) si la auditoría falla, también hace rollback completo (registrarAuditoriaTx no silencia errores)", async () => {
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("fallo de auditoría"));
    await expect(cerrar()).rejects.toThrow("fallo de auditoría");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("si el plan cambió de estado entre la lectura y el UPDATE, se revierte y se informa (sin excepción)", async () => {
    planUpdateAffectedRows = 0;
    const r = await cerrar();
    expect(r.ok).toBe(false);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("siempre libera la conexión (conn.release), tanto en éxito como en error", async () => {
    await cerrar();
    expect(conn.release).toHaveBeenCalledOnce();
  });
});

describe("puedeCerrarManualmente — criterio PURO compartido con la UI (23-25)", () => {
  it.each(["Programado", "Cargado", "En ruta"])("25) permite cierre manual desde %s (CON tarifa)", (estado) => {
    expect(puedeCerrarManualmente(estado, true, true)).toBe(true);
  });

  it.each(["Cerrado", "Cancelado", "Descargado"])("24) no permite cierre manual desde %s", (estado) => {
    expect(puedeCerrarManualmente(estado, true, true)).toBe(false);
  });

  it.each(["Programado", "Cargado", "En ruta"])("PLANES-TARIFA-CIERRE-1 (4) — %s SIN tarifa nunca permite cierre manual", (estado) => {
    expect(puedeCerrarManualmente(estado, false, true)).toBe(false);
  });
});

/**
 * PROGRAMACION-VIAJES-TERCERIZADOS-1 (sección 22) — cerrarViaje() (cierre
 * normal, no manual) no tenía pruebas dedicadas en este archivo; se agregan
 * aquí, centradas en el único cambio de este ticket: la auditoría ahora
 * incluye tipo_viaje. El UPDATE atómico en sí (transición de estados) no
 * se modificó — sección 19: Tercerizado nunca bloquea el cierre, y en
 * efecto el UPDATE ni siquiera consulta tipo_viaje para decidir.
 */
describe("cerrarViaje (no manual) — auditoría incluye tipo_viaje", () => {
  it("un plan Tercerizado cerrado audita 'Tipo: Tercerizado'", async () => {
    plan = { id: 10, estado: "Descargado", tipo_viaje: "Tercerizado", tarifa_comercial: 500 };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: true });
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ empresaId: 7, usuario: "ops1", accion: "cerrar_viaje", modulo: "tms" }),
    );
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("Tercerizado");
  });

  it("un plan Propio cerrado audita 'Tipo: Propio'", async () => {
    plan = { id: 11, estado: "Descargado", tipo_viaje: "Propio", tarifa_comercial: 500 };
    await cerrarViaje(7, 11, "ops1");
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toBe("Plan #11 → Cerrado · tipo Propio");
  });

  it("una fila legada sin tipo_viaje audita 'Propio' por defecto, nunca revienta", async () => {
    plan = { id: 12, estado: "Descargado", tarifa_comercial: 500 };
    const r = await cerrarViaje(7, 12, "ops1");
    expect(r.ok).toBe(true);
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("tipo Propio");
  });

  it("el tipo_viaje se lee acotado por empresa_id (aislamiento multiempresa)", async () => {
    plan = { id: 10, estado: "Descargado", tipo_viaje: "Propio", tarifa_comercial: 500 };
    await cerrarViaje(42, 10, "ops1");
    const lectura = conn.query.mock.calls.find(([sql]) => String(sql).includes("SELECT tipo_viaje"))!;
    expect(String(lectura[0])).toContain("empresa_id = ?");
    expect(lectura[1]).toEqual([10, 42]);
  });
});

/**
 * TMS-CIERRE-MASIVO-1 (ajuste) — cerrarViaje() es TRANSACCIONAL: UPDATE +
 * lectura de tipo_viaje + auditoría individual se comprometen juntos.
 * ok:true => cerrado Y auditado; excepción => rollback (nunca un cierre
 * silencioso reportado como error).
 */
describe("cerrarViaje (no manual) — transacción y consistencia", () => {
  it("camino feliz: begin → UPDATE condicional → tipo_viaje → auditoría (misma conexión) → commit; sin rollback", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: true });
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
    const update = conn.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE tms_planes_viaje"))!;
    expect(String(update[0])).toContain("p.estado = 'Descargado'");
    expect(String(update[0])).toContain("p.estado IN ('En ruta', 'Cargado')");
    expect(update[1]).toEqual(["ops1", 10, 7]);
    expect(conn.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(update ? conn.execute.mock.invocationCallOrder[0] : 0);
    expect(vi.mocked(registrarAuditoriaTx).mock.invocationCallOrder[0]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
    expect(registrarAuditoria).not.toHaveBeenCalled(); // ya no auditoría fuera de la transacción
  });

  it("si la auditoría falla DESPUÉS del UPDATE: rollback, se relanza el error y el viaje NO queda cerrado", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("auditoría falló"));
    await expect(cerrarViaje(7, 10, "ops1")).rejects.toThrow("auditoría falló");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("si falla la lectura de tipo_viaje después del UPDATE: rollback y sin auditoría", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    const original = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (String(sql).includes("SELECT tipo_viaje")) throw new Error("conexión perdida");
      return original(sql, params);
    });
    await expect(cerrarViaje(7, 10, "ops1")).rejects.toThrow("conexión perdida");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("si el rollback mismo falla se conserva el error ORIGINAL y se libera la conexión", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("auditoría falló"));
    conn.rollback.mockRejectedValueOnce(new Error("rollback falló"));
    await expect(cerrarViaje(7, 10, "ops1")).rejects.toThrow("auditoría falló");
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("doble clic / concurrencia: el UPDATE condicional (affectedRows) evita el doble cierre y no audita", async () => {
    plan = { id: 10, estado: "Cerrado", tarifa_comercial: 500 };
    planUpdateAffectedRows = 0;
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: false, error: "Este viaje ya fue cerrado." });
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.release).toHaveBeenCalledOnce();
  });
});

describe("cerrarViaje (no manual) — mensajes cuando NO es elegible (sin cambios)", () => {
  beforeEach(() => { planUpdateAffectedRows = 0; });

  it("no existe / es de otra empresa -> 'Viaje no encontrado.'", async () => {
    plan = undefined;
    expect(await cerrarViaje(7, 10, "ops1")).toEqual({ ok: false, error: "Viaje no encontrado." });
  });

  it("En ruta o Cargado sin llegada registrada -> mensaje de llegada pendiente", async () => {
    for (const estado of ["En ruta", "Cargado"]) {
      plan = { id: 10, estado, llegada_registrada: 0, tarifa_comercial: 500 };
      const r = await cerrarViaje(7, 10, "ops1");
      expect(r).toEqual({ ok: false, error: "El piloto todavía no ha registrado la llegada de este viaje; no se puede cerrar todavía." });
    }
  });

  it("Programado -> mensaje genérico con el estado actual", async () => {
    plan = { id: 10, estado: "Programado", llegada_registrada: 1, tarifa_comercial: 500 };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: false, error: `Este viaje está "Programado"; solo se puede cerrar cuando el piloto ya registró la llegada.` });
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  /**
   * PLANES-TARIFA-CIERRE-1 (corrección de orden de mensajes) — Cancelado obtiene su propio mensaje ahora
   * (antes caía en el genérico "solo se puede cerrar cuando el piloto ya registró la llegada", confuso para
   * un viaje cancelado). Mismo texto que motivoNoCierreNormal() en cierre-viaje-shared.ts.
   */
  it("Cancelado -> mensaje propio de cancelado (ya no el genérico de llegada)", async () => {
    plan = { id: 10, estado: "Cancelado", llegada_registrada: 1, tarifa_comercial: 500 };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: false, error: "Este viaje está cancelado; no admite cierre." });
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

/**
 * PLANES-TARIFA-CIERRE-1 — ningún viaje puede pasar a Cerrado sin tarifa_comercial asignada (`!== null`,
 * NUNCA `> 0`: Q0.00 capturado explícitamente SÍ cuenta). Tests 7-12 del ticket "PLANES / VIAJES: BLOQUEAR
 * CIERRE SIN TARIFA".
 */
describe("cerrarViaje (no manual) — exige tarifa_comercial (PLANES-TARIFA-CIERRE-1)", () => {
  it("7) Descargado CON tarifa -> cierra (camino feliz, ya cubierto arriba con tarifa_comercial: 500 por defecto)", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: true });
  });

  it("8) Descargado SIN tarifa (null) -> NO cierra, mensaje específico", async () => {
    planUpdateAffectedRows = 0;
    plan = { id: 10, estado: "Descargado", tarifa_comercial: null };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: false, error: "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada." });
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("9) En ruta + llegada registrada + tarifa -> cierra", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "cerrado" };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: true });
  });

  it("10) En ruta + llegada registrada + tarifa null -> NO cierra (sin tarifa, aunque la llegada sí esté)", async () => {
    planUpdateAffectedRows = 0;
    plan = { id: 10, estado: "En ruta", llegada_registrada: 1, tarifa_comercial: null };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: false, error: "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada." });
  });

  it("11) el UPDATE condicional incluye 'p.tarifa_comercial IS NOT NULL' en la MISMA transición atómica (nunca una verificación separada)", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    await cerrarViaje(7, 10, "ops1");
    const update = conn.execute.mock.calls.find(([sql]) => String(sql).includes("UPDATE tms_planes_viaje"))!;
    expect(String(update[0])).toContain("p.tarifa_comercial IS NOT NULL");
  });

  it("12) carrera: la tarifa desapareció justo antes del UPDATE (affectedRows=0 aunque el estado sea válido) -> NO cierra, mensaje de tarifa (no el genérico)", async () => {
    // Simula: el UPDATE (que exige tarifa_comercial IS NOT NULL) no afecta ninguna fila porque la tarifa ya
    // no está, pero la consulta diagnóstica posterior (una lectura DESPUÉS del intento fallido) confirma que
    // el estado seguía siendo válido — el único motivo del fallo fue la tarifa, nunca el estado/llegada.
    planUpdateAffectedRows = 0;
    plan = { id: 10, estado: "Descargado", tarifa_comercial: null };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: false, error: "No se puede cerrar este viaje porque todavía no tiene una tarifa asignada." });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("Q0.00 (tarifa_comercial = 0, NO null) SÍ cuenta como tarifa asignada -> cierra", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 0 };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: true });
  });
});

/**
 * REQUISITO DE SECUENCIA (viaje realizado → REPORTE_RECIBIDO → ajustes/cargos → CERRAR → liquidar): solo se cierra con la
 * liquidación EXACTAMENTE en REPORTE_RECIBIDO, validado en servidor bajo lock y dentro de la misma transacción.
 */
describe("cerrarViaje (normal) — exige REPORTE_RECIBIDO", () => {
  const MSG = "No se puede cerrar el viaje porque el reporte aún no ha sido recibido.";

  it("sin fila de liquidación -> 409 REPORTE_NO_RECIBIDO, rollback, sin auditoría ni commit", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    liquidacion = undefined;
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: false, error: MSG, codigo: "REPORTE_NO_RECIBIDO" });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it.each(["PENDIENTE", "SIN_REPORTE", "EN_AJUSTE", "LIQUIDADO", "RELIQUIDADO", ""])(
    "liquidación en %s SIN evento REPORTE_RECIBIDO NO habilita el cierre (el estado posterior por sí solo no basta)",
    async (estado) => {
      plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
      liquidacion = { estado };
      const r = await cerrarViaje(7, 10, "ops1");
      expect(r).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
      expect(conn.commit).not.toHaveBeenCalled();
    },
  );

  it("REPORTE_RECIBIDO -> cierra (camino feliz) y la liquidación no se modifica ni se crea", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    const r = await cerrarViaje(7, 10, "ops1");
    expect(r).toEqual({ ok: true });
    expect(conn.commit).toHaveBeenCalledOnce();
    // Solo LEE la liquidación (FOR UPDATE); nunca escribe en tms_viaje_liquidaciones / eventos / cargos.
    const todas = [...conn.query.mock.calls, ...conn.execute.mock.calls].map(([sql]) => String(sql));
    expect(todas.some((q) => /(INSERT INTO|UPDATE|DELETE FROM)\s+tms_viaje_(liquidacion|cargo)/i.test(q))).toBe(false);
    const lectura = conn.query.mock.calls.find(([sql]) => String(sql).includes("FROM tms_viaje_liquidaciones"))!;
    expect(String(lectura[0])).toContain("FOR UPDATE");
    expect(String(lectura[0])).toContain("empresa_id = ? AND plan_id = ?");
    expect(lectura[1]).toEqual([7, 10]); // acotado por la empresa de la sesión
  });

  it("orden de locks: plan (UPDATE) → liquidación FOR UPDATE → auditoría → commit", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    await cerrarViaje(7, 10, "ops1");
    const iUpdate = conn.execute.mock.invocationCallOrder[0];
    const iLiq = conn.query.mock.invocationCallOrder[conn.query.mock.calls.findIndex(([sql]) => String(sql).includes("FROM tms_viaje_liquidaciones"))];
    expect(iUpdate).toBeLessThan(iLiq);
    expect(iLiq).toBeLessThan(vi.mocked(registrarAuditoriaTx).mock.invocationCallOrder[0]);
    expect(vi.mocked(registrarAuditoriaTx).mock.invocationCallOrder[0]).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
  });

  it("tercerizado: misma regla (sin reporte bloquea; con REPORTE_RECIBIDO cierra)", async () => {
    plan = { id: 10, estado: "Descargado", tipo_viaje: "Tercerizado", tarifa_comercial: 500 };
    liquidacion = undefined;
    expect(await cerrarViaje(7, 10, "ops1")).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
    vi.clearAllMocks();
    liquidacion = { estado: "REPORTE_RECIBIDO" };
    expect(await cerrarViaje(7, 10, "ops1")).toEqual({ ok: true });
  });

  it("Cancelado y Cerrado conservan sus mensajes actuales (el reporte es el ÚLTIMO requisito)", async () => {
    planUpdateAffectedRows = 0;
    liquidacion = undefined;
    plan = { id: 10, estado: "Cancelado", tarifa_comercial: 500 };
    expect(await cerrarViaje(7, 10, "ops1")).toEqual({ ok: false, error: "Este viaje está cancelado; no admite cierre." });
    plan = { id: 10, estado: "Cerrado", tarifa_comercial: 500 };
    expect(await cerrarViaje(7, 10, "ops1")).toEqual({ ok: false, error: "Este viaje ya fue cerrado." });
    // No es elegible por estado: tampoco consulta la liquidación (no hay nada que cerrar).
    expect(conn.query.mock.calls.some(([sql]) => String(sql).includes("FROM tms_viaje_liquidaciones"))).toBe(false);
  });

  it("tabla de liquidaciones ausente (errno 1146) = reporte no recibido (falla cerrado, nunca un cierre silencioso)", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    errnoLiquidacion = 1146;
    expect(await cerrarViaje(7, 10, "ops1")).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("un error de BD distinto al leer la liquidación hace rollback y se relanza (no se cierra)", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    errnoLiquidacion = 1205;
    await expect(cerrarViaje(7, 10, "ops1")).rejects.toThrow();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("cerrarViajeManual — exige REPORTE_RECIBIDO", () => {
  const MSG = "No se puede cerrar el viaje porque el reporte aún no ha sido recibido.";

  it("sin fila de liquidación -> rechazado ANTES de tocar flota_viajes o el plan", async () => {
    plan = { id: 10, estado: "En ruta", tarifa_comercial: 500 };
    flota = { id: 55, estado: "abierto" };
    liquidacion = undefined;
    const r = await cerrarViajeManual({ empresaId: 7, planId: 10, usuario: "jefe", motivo: "Cierre administrativo del día" });
    expect(r).toEqual({ ok: false, error: MSG, codigo: "REPORTE_NO_RECIBIDO" });
    expect(conn.execute).not.toHaveBeenCalled(); // ni UPDATE flota_viajes ni UPDATE del plan
    expect(conn.commit).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it.each(["EN_AJUSTE", "LIQUIDADO", "PENDIENTE"])("liquidación en %s no habilita el cierre manual", async (estado) => {
    liquidacion = { estado };
    const r = await cerrarViajeManual({ empresaId: 7, planId: 10, usuario: "jefe", motivo: "Cierre administrativo del día" });
    expect(r).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
  });

  it("REPORTE_RECIBIDO -> cierra; orden de locks plan FOR UPDATE → liquidación FOR UPDATE → flota FOR UPDATE", async () => {
    plan = { id: 10, estado: "Programado", tarifa_comercial: 500 };
    const r = await cerrarViajeManual({ empresaId: 7, planId: 10, usuario: "jefe", motivo: "Cierre administrativo del día" });
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
    const sqls = conn.query.mock.calls.map(([sql]) => String(sql));
    const iPlan = sqls.findIndex((q) => q.includes("FROM tms_planes_viaje") && q.includes("FOR UPDATE"));
    const iLiq = sqls.findIndex((q) => q.includes("FROM tms_viaje_liquidaciones") && q.includes("FOR UPDATE"));
    const iFlota = sqls.findIndex((q) => q.includes("FROM flota_viajes") && q.includes("FOR UPDATE"));
    expect(iPlan).toBeGreaterThanOrEqual(0);
    expect(iPlan).toBeLessThan(iLiq);
    expect(iLiq).toBeLessThan(iFlota);
  });

  it("prioridad de mensajes: Cerrado, Cancelado y sin tarifa se informan antes que el reporte", async () => {
    liquidacion = undefined;
    plan = { id: 10, estado: "Cerrado", tarifa_comercial: 500 };
    expect(await cerrarViajeManual({ empresaId: 7, planId: 10, usuario: "j", motivo: "Cierre administrativo del día" })).toEqual({ ok: false, error: "Este viaje ya fue cerrado." });
    plan = { id: 10, estado: "Programado", tarifa_comercial: null };
    expect(await cerrarViajeManual({ empresaId: 7, planId: 10, usuario: "j", motivo: "Cierre administrativo del día" })).toMatchObject({
      ok: false, error: expect.stringContaining("tarifa"),
    });
  });

  it("tercerizado sin reporte bloqueado; con REPORTE_RECIBIDO permitido", async () => {
    plan = { id: 10, estado: "En ruta", tipo_viaje: "Tercerizado", tarifa_comercial: 500 };
    liquidacion = undefined;
    expect(await cerrarViajeManual({ empresaId: 7, planId: 10, usuario: "j", motivo: "Cierre administrativo del día" })).toMatchObject({ codigo: "REPORTE_NO_RECIBIDO" });
    liquidacion = { estado: "REPORTE_RECIBIDO" };
    expect(await cerrarViajeManual({ empresaId: 7, planId: 10, usuario: "j", motivo: "Cierre administrativo del día" })).toMatchObject({ ok: true });
  });
});

/**
 * COMPATIBILIDAD CON PLANES HEREDADOS — «el reporte FUE recibido»: liquidación actual REPORTE_RECIBIDO, o evidencia histórica
 * append-only (evento REPORTE_RECIBIDO). EN_AJUSTE/LIQUIDADO por sí solos NO habilitan. El cierre solo LEE.
 */
describe("cierre — compatibilidad con planes heredados (evento histórico REPORTE_RECIBIDO)", () => {
  const MSG = "No se puede cerrar el viaje porque el reporte aún no ha sido recibido.";

  it.each(["EN_AJUSTE", "LIQUIDADO"])("%s CON evento REPORTE_RECIBIDO: el cierre normal procede (plan abierto heredado)", async (estado) => {
    plan = { id: 587, estado: "Programado", tarifa_comercial: 500 };
    // Programado no cierra por el camino normal; se usa Descargado (misma regla de reporte) para aislar el requisito.
    plan = { id: 587, estado: "Descargado", tarifa_comercial: 500 };
    liquidacion = { estado };
    eventoReporte = true;
    expect(await cerrarViaje(7, 587, "jefe")).toEqual({ ok: true });
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it.each(["EN_AJUSTE", "LIQUIDADO"])("%s SIN evento (fixture inválido): bloqueado con REPORTE_NO_RECIBIDO", async (estado) => {
    plan = { id: 587, estado: "Descargado", tarifa_comercial: 500 };
    liquidacion = { estado };
    eventoReporte = false;
    expect(await cerrarViaje(7, 587, "jefe")).toEqual({ ok: false, error: MSG, codigo: "REPORTE_NO_RECIBIDO" });
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("REPORTE_RECIBIDO actual NO consulta el evento (la liquidación vigente basta)", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    liquidacion = { estado: "REPORTE_RECIBIDO" };
    expect(await cerrarViaje(7, 10, "jefe")).toEqual({ ok: true });
    expect(conn.query.mock.calls.some(([sql]) => String(sql).includes("FROM tms_viaje_liquidacion_eventos"))).toBe(false);
  });

  it("sin fila de liquidación: bloqueado sin consultar eventos (sin liquidación no puede haber evento)", async () => {
    plan = { id: 10, estado: "Descargado", tarifa_comercial: 500 };
    liquidacion = undefined;
    eventoReporte = true; // incluso si el mock «inventara» un evento, sin fila no habilita
    expect(await cerrarViaje(7, 10, "jefe")).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
    expect(conn.query.mock.calls.some(([sql]) => String(sql).includes("FROM tms_viaje_liquidacion_eventos"))).toBe(false);
  });

  it("el evento se consulta acotado por empresa + plan + tipo, solo lectura y bajo el mismo orden (plan → liquidación → evento)", async () => {
    plan = { id: 587, estado: "Descargado", tarifa_comercial: 500 };
    liquidacion = { estado: "EN_AJUSTE" };
    eventoReporte = true;
    await cerrarViaje(42, 587, "jefe");
    const llamadas = conn.query.mock.calls;
    const iEvento = llamadas.findIndex(([sql]) => String(sql).includes("FROM tms_viaje_liquidacion_eventos"));
    const iLiq = llamadas.findIndex(([sql]) => String(sql).includes("FROM tms_viaje_liquidaciones"));
    expect(iLiq).toBeGreaterThanOrEqual(0);
    expect(iLiq).toBeLessThan(iEvento);
    const [sql, params] = llamadas[iEvento];
    expect(String(sql)).toContain("empresa_id = ? AND plan_id = ? AND tipo = 'REPORTE_RECIBIDO'");
    expect(params).toEqual([42, 587]);
    // Nunca escribe liquidación ni eventos.
    const todas = [...conn.query.mock.calls, ...conn.execute.mock.calls].map(([q]) => String(q));
    expect(todas.some((q) => /(INSERT INTO|UPDATE|DELETE FROM)\s+tms_viaje_(liquidacion|cargo)/i.test(q))).toBe(false);
  });

  it("cierre MANUAL: EN_AJUSTE/LIQUIDADO con evento habilitan; sin evento no", async () => {
    plan = { id: 587, estado: "Programado", tarifa_comercial: 500 };
    liquidacion = { estado: "EN_AJUSTE" };
    eventoReporte = true;
    const m = { empresaId: 7, planId: 587, usuario: "jefe", motivo: "Regularización de viaje de prueba heredado" };
    expect(await cerrarViajeManual(m)).toEqual({ ok: true, flotaViajeCerrado: false });
    vi.clearAllMocks();
    eventoReporte = false;
    liquidacion = { estado: "LIQUIDADO" };
    expect(await cerrarViajeManual(m)).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
    expect(conn.execute).not.toHaveBeenCalled();
  });
});

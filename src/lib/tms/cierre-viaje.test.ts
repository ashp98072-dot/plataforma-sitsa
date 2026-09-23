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
  plan = { id: 10, estado: "Programado" };
  flota = undefined;
  planUpdateAffectedRows = 1;

  conn.query.mockImplementation(async (sql: string) => {
    const s = String(sql);
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
    plan = { id: 10, estado: "Programado" };
    flota = undefined;
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("2) no se crea ninguna fila sintética en flota_viajes cuando no existe ninguna", async () => {
    plan = { id: 10, estado: "Programado" };
    flota = undefined;
    await cerrar();
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO flota_viajes"))).toBe(false);
    expect(conn.execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE flota_viajes"))).toBe(false);
  });

  it("3) Cargado se puede cerrar manualmente", async () => {
    plan = { id: 10, estado: "Cargado" };
    const r = await cerrar();
    expect(r.ok).toBe(true);
  });

  it("4) En ruta se puede cerrar manualmente", async () => {
    plan = { id: 10, estado: "En ruta" };
    const r = await cerrar();
    expect(r.ok).toBe(true);
  });

  it("5) Cerrado no se puede volver a cerrar", async () => {
    plan = { id: 10, estado: "Cerrado" };
    const r = await cerrar();
    expect(r).toEqual({ ok: false, error: "Este viaje ya fue cerrado." });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("6) Cancelado no se puede cerrar", async () => {
    plan = { id: 10, estado: "Cancelado" };
    const r = await cerrar();
    expect(r).toEqual({ ok: false, error: "Este viaje está cancelado; no admite cierre manual." });
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("Descargado (legado) tampoco admite cierre manual (no está en la lista permitida)", async () => {
    plan = { id: 10, estado: "Descargado" };
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
    plan = { id: 10, estado: "En ruta" };
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
    plan = { id: 10, estado: "Programado" };
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
    plan = { id: 10, estado: "Programado", tipo_viaje: "Tercerizado" };
    const r = await cerrar();
    expect(r.ok).toBe(true);
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("Tipo: Tercerizado");
  });

  it("un plan sin tipo_viaje en la fila (dato legado) audita como Propio, nunca revienta", async () => {
    plan = { id: 10, estado: "Programado" };
    const r = await cerrar();
    expect(r.ok).toBe(true);
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("Tipo: Propio");
  });
});

describe("cerrarViajeManual — flota_viajes huérfano (18-21)", () => {
  it("18) si existe flota_viajes 'abierto', queda 'cerrado'", async () => {
    plan = { id: 10, estado: "En ruta" };
    flota = { id: 55, estado: "abierto" };
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: true });
    const [sql, params] = conn.execute.mock.calls.find(([s]) => String(s).includes("UPDATE flota_viajes"))!;
    expect(String(sql)).toContain("estado = 'cerrado'");
    expect(params).toEqual([55, 7]);
  });

  it("19) nunca escribe km_llegada/km_salida — no se fabrican kilómetros", async () => {
    plan = { id: 10, estado: "En ruta" };
    flota = { id: 55, estado: "abierto" };
    await cerrar();
    const [sql] = conn.execute.mock.calls.find(([s]) => String(s).includes("UPDATE flota_viajes"))!;
    expect(String(sql)).not.toMatch(/km_llegada\s*=\s*\?/);
    expect(String(sql)).not.toMatch(/km_salida\s*=\s*\?/);
  });

  it("20) nunca escribe coordenadas (latitud/longitud) — no se fabrica ubicación", async () => {
    plan = { id: 10, estado: "En ruta" };
    flota = { id: 55, estado: "abierto" };
    await cerrar();
    const [sql] = conn.execute.mock.calls.find(([s]) => String(s).includes("UPDATE flota_viajes"))!;
    expect(String(sql)).not.toMatch(/latitud|longitud/i);
  });

  it("21) no se crea ninguna evidencia (tms_evidencias/flota_viaje_evidencias) durante el cierre manual", async () => {
    plan = { id: 10, estado: "En ruta" };
    flota = { id: 55, estado: "abierto" };
    await cerrar();
    const todas = [...conn.query.mock.calls, ...conn.execute.mock.calls].map(([s]) => String(s));
    expect(todas.some((s) => s.includes("tms_evidencias") || s.includes("flota_viaje_evidencias") || s.includes("flota_lecturas"))).toBe(false);
  });

  it("un flota_viajes ya 'cerrado' (llegada real ya registrada) NO se vuelve a tocar", async () => {
    plan = { id: 10, estado: "En ruta" };
    flota = { id: 55, estado: "cerrado" };
    const r = await cerrar();
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
    expect(conn.execute.mock.calls.some(([s]) => String(s).includes("UPDATE flota_viajes"))).toBe(false);
  });
});

describe("cerrarViajeManual — transacción y errores (22)", () => {
  it("22) un error durante el cierre hace rollback completo, nunca commit", async () => {
    plan = { id: 10, estado: "En ruta" };
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
  it.each(["Programado", "Cargado", "En ruta"])("25) permite cierre manual desde %s", (estado) => {
    expect(puedeCerrarManualmente(estado)).toBe(true);
  });

  it.each(["Cerrado", "Cancelado", "Descargado"])("24) no permite cierre manual desde %s", (estado) => {
    expect(puedeCerrarManualmente(estado)).toBe(false);
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
    plan = { id: 10, estado: "Descargado", tipo_viaje: "Tercerizado" };
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
    plan = { id: 11, estado: "Descargado", tipo_viaje: "Propio" };
    await cerrarViaje(7, 11, "ops1");
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toBe("Plan #11 → Cerrado · tipo Propio");
  });

  it("una fila legada sin tipo_viaje audita 'Propio' por defecto, nunca revienta", async () => {
    plan = { id: 12, estado: "Descargado" };
    const r = await cerrarViaje(7, 12, "ops1");
    expect(r.ok).toBe(true);
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("tipo Propio");
  });

  it("el tipo_viaje se lee acotado por empresa_id (aislamiento multiempresa)", async () => {
    plan = { id: 10, estado: "Descargado", tipo_viaje: "Propio" };
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
    plan = { id: 10, estado: "Descargado" };
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
    plan = { id: 10, estado: "Descargado" };
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("auditoría falló"));
    await expect(cerrarViaje(7, 10, "ops1")).rejects.toThrow("auditoría falló");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("si falla la lectura de tipo_viaje después del UPDATE: rollback y sin auditoría", async () => {
    plan = { id: 10, estado: "Descargado" };
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
    plan = { id: 10, estado: "Descargado" };
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("auditoría falló"));
    conn.rollback.mockRejectedValueOnce(new Error("rollback falló"));
    await expect(cerrarViaje(7, 10, "ops1")).rejects.toThrow("auditoría falló");
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("doble clic / concurrencia: el UPDATE condicional (affectedRows) evita el doble cierre y no audita", async () => {
    plan = { id: 10, estado: "Cerrado" };
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
      plan = { id: 10, estado, llegada_registrada: 0 };
      const r = await cerrarViaje(7, 10, "ops1");
      expect(r).toEqual({ ok: false, error: "El piloto todavía no ha registrado la llegada de este viaje; no se puede cerrar todavía." });
    }
  });

  it("Programado / Cancelado -> mensaje genérico con el estado actual", async () => {
    for (const estado of ["Programado", "Cancelado"]) {
      plan = { id: 10, estado, llegada_registrada: 1 };
      const r = await cerrarViaje(7, 10, "ops1");
      expect(r).toEqual({ ok: false, error: `Este viaje está "${estado}"; solo se puede cerrar cuando el piloto ya registró la llegada.` });
    }
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

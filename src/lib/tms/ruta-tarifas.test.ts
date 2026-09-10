import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  actualizarTarifaRuta,
  cambiarEstadoTarifa,
  crearTarifaRuta,
  marcarPredeterminada,
  tarifaParaSnapshot,
  type ActorTarifa,
} from "./ruta-tarifas";

/**
 * RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 — tests targeted del
 * catálogo de opciones de tarifa: "solo una predeterminada activa por
 * ruta", sincronización de tarifa_referencia, aislamiento multiempresa
 * (§5) y que NUNCA se toca tms_planes_viaje (los snapshots históricos de
 * los viajes no cambian aunque cambie la tarifa maestra).
 */

const ACTOR: ActorTarifa = { usuarioId: 9, nombre: "Heber Sitan" };

type QueryRow = Record<string, unknown>;

function conexion(handlers: {
  query?: (sql: string, params: unknown[]) => QueryRow[];
} = {}) {
  const ejecutadas: { sql: string; params: unknown[] }[] = [];
  const conn = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const rows = handlers.query?.(sql, params) ?? [];
      return [rows];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      ejecutadas.push({ sql, params });
      return [{ insertId: 123, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  vi.mocked(query).mockResolvedValue([] as never); // listarTarifasDeRuta al final
  return { conn, ejecutadas };
}

beforeEach(() => vi.resetAllMocks());

describe("crearTarifaRuta", () => {
  it("la PRIMERA tarifa activa de la ruta nace predeterminada y sincroniza tarifa_referencia", async () => {
    const { ejecutadas } = conexion({
      query: (sql) => {
        if (sql.includes("FROM tms_cliente_rutas WHERE id")) return [{ id: 44 }]; // ruta de la empresa
        if (sql.includes("COUNT(*) AS n")) return [{ n: 0 }]; // no hay activas
        if (sql.includes("SELECT monto FROM tms_ruta_tarifas")) return [{ monto: 1500 }]; // predeterminada activa
        return [];
      },
    });
    await crearTarifaRuta(7, 44, { nombre: "Tarifa normal", monto: 1500 }, ACTOR);
    const insert = ejecutadas.find((e) => e.sql.includes("INSERT INTO tms_ruta_tarifas"));
    expect(insert).toBeDefined();
    // predeterminada = 1 (posición 9 en el VALUES, tras vigente_hasta)
    expect(insert!.params).toContain(1);
    const syncRef = ejecutadas.find((e) => e.sql.includes("UPDATE tms_cliente_rutas SET tarifa_referencia"));
    expect(syncRef).toBeDefined();
    expect(syncRef!.params).toEqual([1500, 44, 7]);
    expect(vi.mocked(registrarAuditoriaTx)).toHaveBeenCalled();
  });

  it("si ya hay una tarifa activa, la nueva NO nace predeterminada salvo que se pida", async () => {
    const { ejecutadas } = conexion({
      query: (sql) => {
        if (sql.includes("FROM tms_cliente_rutas WHERE id")) return [{ id: 44 }];
        if (sql.includes("COUNT(*) AS n")) return [{ n: 2 }];
        if (sql.includes("SELECT monto FROM tms_ruta_tarifas")) return [{ monto: 1500 }];
        return [];
      },
    });
    await crearTarifaRuta(7, 44, { nombre: "Tarifa lluvia", monto: 1800 }, ACTOR);
    // No debe haber un UPDATE que ponga predeterminada = 0 en todas (solo ocurre si la nueva es predeterminada).
    const reset = ejecutadas.find((e) => e.sql.includes("SET predeterminada = 0 WHERE empresa_id = ? AND ruta_id = ?"));
    expect(reset).toBeUndefined();
  });

  it("§5 — rechaza si la ruta no pertenece a la empresa", async () => {
    conexion({ query: () => [] }); // rutaDeEmpresaTx no encuentra la ruta
    await expect(
      crearTarifaRuta(7, 999, { nombre: "X", monto: 10 }, ACTOR),
    ).rejects.toThrow(/otra empresa|no existe/i);
  });
});

describe("marcarPredeterminada — solo una predeterminada activa por ruta", () => {
  it("pone predeterminada = 0 en toda la ruta y luego = 1 en la elegida", async () => {
    const { ejecutadas } = conexion({
      query: (sql) => {
        if (sql.includes("SELECT * FROM tms_ruta_tarifas WHERE id")) return [{ id: 5, ruta_id: 44, activa: 1, nombre: "Tarifa lluvia" }];
        if (sql.includes("SELECT monto FROM tms_ruta_tarifas")) return [{ monto: 1800 }];
        return [];
      },
    });
    await marcarPredeterminada(7, 5, ACTOR);
    const reset = ejecutadas.findIndex((e) => e.sql.includes("SET predeterminada = 0 WHERE empresa_id = ? AND ruta_id = ?"));
    const set = ejecutadas.findIndex((e) => e.sql.includes("SET\n       predeterminada = 1") || e.sql.includes("predeterminada = 1, actualizado_por"));
    expect(reset).toBeGreaterThanOrEqual(0);
    expect(set).toBeGreaterThan(reset);
    const syncRef = ejecutadas.find((e) => e.sql.includes("UPDATE tms_cliente_rutas SET tarifa_referencia"));
    expect(syncRef!.params).toEqual([1800, 44, 7]);
  });

  it("rechaza marcar predeterminada una tarifa inactiva", async () => {
    conexion({
      query: (sql) => (sql.includes("SELECT * FROM tms_ruta_tarifas WHERE id") ? [{ id: 5, ruta_id: 44, activa: 0, nombre: "X" }] : []),
    });
    await expect(marcarPredeterminada(7, 5, ACTOR)).rejects.toThrow(/activa/i);
  });

  it("§5 — rechaza una tarifa de otra empresa (no aparece con ese empresa_id)", async () => {
    conexion({ query: () => [] });
    await expect(marcarPredeterminada(7, 5, ACTOR)).rejects.toThrow(/otra empresa|no existe/i);
  });
});

describe("cambiarEstadoTarifa", () => {
  it("al desactivar la predeterminada, promueve otra activa y re-sincroniza tarifa_referencia", async () => {
    const { ejecutadas } = conexion({
      query: (sql) => {
        if (sql.includes("SELECT * FROM tms_ruta_tarifas WHERE id")) return [{ id: 5, ruta_id: 44, activa: 1, predeterminada: 1, nombre: "Tarifa normal" }];
        if (sql.includes("WHERE empresa_id = ? AND ruta_id = ? AND activa = 1\n         ORDER BY vigente_desde DESC")) return [{ id: 8 }];
        if (sql.includes("SELECT monto FROM tms_ruta_tarifas")) return [{ monto: 1800 }];
        return [];
      },
    });
    await cambiarEstadoTarifa(7, 5, false, ACTOR);
    const promocion = ejecutadas.find((e) => e.sql.includes("SET predeterminada = 1 WHERE id = ? AND empresa_id = ?"));
    expect(promocion?.params).toEqual([8, 7]);
  });
});

describe("actualizarTarifaRuta — NUNCA toca tms_planes_viaje (§2/§3: los viajes conservan su snapshot)", () => {
  it("solo escribe en tms_ruta_tarifas y tms_cliente_rutas", async () => {
    const { ejecutadas } = conexion({
      query: (sql) => {
        if (sql.includes("SELECT * FROM tms_ruta_tarifas WHERE id")) return [{ id: 5, ruta_id: 44, nombre: "Tarifa normal", monto: 1500, moneda: "GTQ", vigente_desde: "2026-01-01", vigente_hasta: null, descripcion: null, observacion: null }];
        if (sql.includes("SELECT monto FROM tms_ruta_tarifas")) return [{ monto: 2000 }];
        return [];
      },
    });
    await actualizarTarifaRuta(7, 5, { monto: 2000 }, ACTOR);
    for (const e of ejecutadas) {
      expect(e.sql).not.toMatch(/tms_planes_viaje/);
    }
    expect(ejecutadas.some((e) => e.sql.includes("UPDATE tms_ruta_tarifas"))).toBe(true);
  });
});

describe("tarifaParaSnapshot — validación por empresa/ruta/activa (§2/§5)", () => {
  it("devuelve null si la consulta no trae fila (tarifa ajena, inactiva o de otra ruta)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    expect(await tarifaParaSnapshot(7, 44, 5)).toBeNull();
  });

  it("devuelve el snapshot mínimo cuando la tarifa es válida", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 5, nombre: "Tarifa lluvia", monto: 1800, moneda: "GTQ" }] as never);
    expect(await tarifaParaSnapshot(7, 44, 5)).toEqual({ id: 5, nombre: "Tarifa lluvia", monto: 1800, moneda: "GTQ" });
  });
});

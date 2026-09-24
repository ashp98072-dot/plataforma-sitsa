import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  actualizarTarifaRuta,
  cambiarEstadoTarifa,
  crearTarifaRuta,
  debeLimpiarTarifaPorCambioDeRuta,
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

describe("debeLimpiarTarifaPorCambioDeRuta — PATCH cambia rutaId sin tarifaId (§2/§3)", () => {
  const base = {
    patchTraeTarifaId: false,
    rutaCambio: true,
    antesTarifaId: 5 as number | null,
    tarifaActualSigueEnRutaNueva: false,
  };

  it("cambió la ruta, no vino tarifaId, y la tarifa actual NO pertenece a la nueva ruta -> LIMPIAR", () => {
    expect(debeLimpiarTarifaPorCambioDeRuta(base)).toBe(true);
  });

  it("cambió la ruta pero la tarifa actual SÍ pertenece a la nueva ruta -> conservar (no limpiar)", () => {
    expect(debeLimpiarTarifaPorCambioDeRuta({ ...base, tarifaActualSigueEnRutaNueva: true })).toBe(false);
  });

  it("el PATCH trae tarifaId -> esa rama valida/snapshotea aparte, aquí nunca se limpia", () => {
    expect(debeLimpiarTarifaPorCambioDeRuta({ ...base, patchTraeTarifaId: true })).toBe(false);
  });

  it("la ruta no cambió -> no se toca el snapshot aunque la tarifa no 'perteneciera'", () => {
    expect(debeLimpiarTarifaPorCambioDeRuta({ ...base, rutaCambio: false })).toBe(false);
  });

  it("el viaje no tenía tarifa del catálogo (antesTarifaId null) -> nada que limpiar", () => {
    expect(debeLimpiarTarifaPorCambioDeRuta({ ...base, antesTarifaId: null })).toBe(false);
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

describe("tarifaParaSnapshot — misma regla de vigencia que el selector (tarifasActivasDeVariasRutas)", () => {
  type Fila = { id: number; empresa_id: number; ruta_id: number; activa: number; vigente_hasta: string | null };
  const HOY = "2026-09-24";
  const filas: Fila[] = [
    { id: 1, empresa_id: 7, ruta_id: 44, activa: 1, vigente_hasta: "2099-01-01" }, // vigente
    { id: 2, empresa_id: 7, ruta_id: 44, activa: 1, vigente_hasta: null }, // sin vencimiento
    { id: 3, empresa_id: 7, ruta_id: 44, activa: 1, vigente_hasta: "2026-09-23" }, // vencida
    { id: 4, empresa_id: 7, ruta_id: 44, activa: 0, vigente_hasta: null }, // inactiva
    { id: 5, empresa_id: 7, ruta_id: 99, activa: 1, vigente_hasta: null }, // de otra ruta
    { id: 6, empresa_id: 8, ruta_id: 44, activa: 1, vigente_hasta: null }, // de otra empresa
    { id: 7, empresa_id: 7, ruta_id: 44, activa: 1, vigente_hasta: HOY }, // vence hoy: aún vigente
  ];
  // Emula el WHERE ENVIADO: si el SQL no trae la regla de vigencia, no se aplica (el test lo detectaría).
  const emular = (sql: string, params: unknown[]) => {
    const [id, empresa, ruta] = params as number[];
    return filas
      .filter((f) => f.id === id && f.empresa_id === empresa && f.ruta_id === ruta)
      .filter((f) => !sql.includes("activa = 1") || f.activa === 1)
      .filter((f) => !sql.includes("(vigente_hasta IS NULL OR vigente_hasta >= CURDATE())") || f.vigente_hasta == null || f.vigente_hasta >= HOY)
      .map((f) => ({ id: f.id, nombre: `T${f.id}`, monto: 100, moneda: "GTQ" }));
  };
  const conConn = { query: async (sql: string, params: unknown[]) => [emular(sql, params)] };

  beforeEach(() => {
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => emular(String(sql), params)) as never);
  });

  const casos: [string, number, number, number, boolean][] = [
    ["1) activa y vigente -> aceptada", 7, 44, 1, true],
    ["2) activa con vigente_hasta NULL -> aceptada", 7, 44, 2, true],
    ["3) activa pero vencida -> rechazada", 7, 44, 3, false],
    ["4) inactiva -> rechazada", 7, 44, 4, false],
    ["5) de otra ruta -> rechazada", 7, 44, 5, false],
    ["6) de otra empresa -> rechazada", 7, 44, 6, false],
    ["7) vence hoy -> aún aceptada (>= CURDATE())", 7, 44, 7, true],
  ];
  for (const [nombre, empresa, ruta, id, ok] of casos) {
    it(`${nombre} (pool y conn de la transacción)`, async () => {
      const esperado = ok ? expect.objectContaining({ id }) : null;
      expect(await tarifaParaSnapshot(empresa, ruta, id)).toEqual(esperado);
      expect(await tarifaParaSnapshot(empresa, ruta, id, conConn)).toEqual(esperado);
    });
  }

  it("la consulta de validación lleva la misma regla de vigencia que el selector", () => {
    const fuente = readFileSync("src/lib/tms/ruta-tarifas.ts", "utf8");
    expect(fuente.match(/\(vigente_hasta IS NULL OR vigente_hasta >= CURDATE\(\)\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

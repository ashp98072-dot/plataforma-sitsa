import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: m.query }));
import {
  asegurarCodigoPlanUnico, asegurarCodigoPlanUnicoTx, esDuplicadoCodigoPlan, generarCodigoPlan, generarCodigoPlanTx, prefijoCodigoPlan,
} from "./codigo-plan";

const FECHA = "2026-09-28";

beforeEach(() => { vi.resetAllMocks(); });

describe("prefijoCodigoPlan", () => {
  it("PLAN-YYYYMMDD-", () => {
    expect(prefijoCodigoPlan(FECHA)).toBe("PLAN-20260928-");
  });
});

describe("generarCodigoPlan / asegurarCodigoPlanUnico (variante del pool)", () => {
  it("sin códigos previos -> -001", async () => {
    m.query.mockResolvedValue([]);
    expect(await generarCodigoPlan(1, FECHA)).toBe("PLAN-20260928-001");
  });
  it("6) código ya existente en DB -> comienza en el siguiente disponible", async () => {
    m.query.mockResolvedValueOnce([{ codigo: "PLAN-20260928-003" }, { codigo: "PLAN-20260928-001" }]);
    expect(await generarCodigoPlan(1, FECHA)).toBe("PLAN-20260928-004");
  });
  it("asegurarCodigoPlanUnico respeta un código deseado libre", async () => {
    m.query.mockResolvedValueOnce([]); // SELECT id ... WHERE codigo = deseado -> libre
    expect(await asegurarCodigoPlanUnico(1, FECHA, "PLAN-20260928-050")).toBe("PLAN-20260928-050");
  });
  it("si el deseado ya existe, propone el siguiente generado", async () => {
    m.query
      .mockResolvedValueOnce([{ id: 9 }]) // el deseado ya existe
      .mockResolvedValueOnce([]) // generarCodigoPlan: sin previos
      .mockResolvedValueOnce([]); // el generado está libre
    expect(await asegurarCodigoPlanUnico(1, FECHA, "PLAN-20260928-050")).toBe("PLAN-20260928-001");
  });
});

describe("PROGRAMACION-COPIA-LOTE-TX-1 — generarCodigoPlanTx / asegurarCodigoPlanUnicoTx (transaction-aware)", () => {
  const conn = (impl: (sql: string, params: unknown[]) => unknown) => ({ query: vi.fn(async (sql: string, params: unknown[]) => [impl(sql, params), []]) });

  it("5) el generador transaction-aware ve códigos insertados previamente por ESA MISMA transacción (nunca consulta el pool)", async () => {
    const c = conn(() => [{ codigo: "PLAN-20260928-001" }, { codigo: "PLAN-20260928-002" }]); // el propio conn.query ya ve las filas sin commit
    const codigo = await generarCodigoPlanTx(c as never, 1, FECHA);
    expect(codigo).toBe("PLAN-20260928-003");
    expect(m.query).not.toHaveBeenCalled(); // NUNCA usa la conexión del pool
    expect(c.query).toHaveBeenCalled();
  });
  it("dos llamadas SECUENCIALES con la MISMA conn (simulando fila 1 y fila 2 del lote) generan códigos distintos", async () => {
    // Simula el estado real: cada llamada ve lo que la anterior "insertó" en la misma transacción. Distingue el
    // SELECT por prefijo (LIKE, para calcular el máximo) del SELECT de existencia exacta (WHERE codigo = ?).
    const insertados = ["PLAN-20260928-001"];
    const c = { query: vi.fn(async (sql: string) => {
      if (String(sql).includes("LIKE")) return [insertados.map((codigo) => ({ codigo })), []];
      return [[], []]; // el código recién calculado nunca choca (esta prueba no ejercita colisión)
    }) };
    const codigo1 = await asegurarCodigoPlanUnicoTx(c as never, 1, FECHA, null);
    insertados.push(codigo1);
    const codigo2 = await asegurarCodigoPlanUnicoTx(c as never, 1, FECHA, null);
    expect([codigo1, codigo2]).toEqual(["PLAN-20260928-002", "PLAN-20260928-003"]);
  });
  it("asegurarCodigoPlanUnicoTx: código ya existente en la transacción -> propone el siguiente disponible", async () => {
    const c = { query: vi.fn() };
    c.query
      .mockResolvedValueOnce([[{ id: 9 }], []]) // el deseado ya existe (visto por esta conexión)
      .mockResolvedValueOnce([[], []]) // generarCodigoPlanCon: sin previos
      .mockResolvedValueOnce([[], []]); // el generado está libre
    expect(await asegurarCodigoPlanUnicoTx(c as never, 1, FECHA, "PLAN-20260928-050")).toBe("PLAN-20260928-001");
  });
});

describe("7-8) esDuplicadoCodigoPlan — SOLO la colisión real del índice (empresa_id, codigo); la lógica completa se prueba en codigo-plan-colision.test.ts", () => {
  const dup = (clave: string, entrada = "7-PLAN-20260928-001") =>
    Object.assign(new Error(`Duplicate entry '${entrada}' for key '${clave}'`), { code: "ER_DUP_ENTRY", errno: 1062, sqlMessage: `Duplicate entry '${entrada}' for key '${clave}'` });
  it("7) ER_DUP_ENTRY / errno 1062 sobre uq_plan -> true", () => {
    expect(esDuplicadoCodigoPlan(dup("uq_plan"))).toBe(true);
    expect(esDuplicadoCodigoPlan(dup("tms_planes_viaje.uq_plan"))).toBe(true); // MySQL 8
    expect(esDuplicadoCodigoPlan({ errno: 1062, sqlMessage: "Duplicate entry '7-PLAN-1' for key 'uq_plan'" })).toBe(true);
  });
  it("un ER_DUP_ENTRY de OTRO índice o sin información del índice -> false (se propaga, no se reintenta)", () => {
    expect(esDuplicadoCodigoPlan(dup("PRIMARY", "31"))).toBe(false);
    expect(esDuplicadoCodigoPlan({ code: "ER_DUP_ENTRY" })).toBe(false);
    expect(esDuplicadoCodigoPlan({ errno: 1062 })).toBe(false);
  });
  it("8) cualquier otro error (FK, timeout, esquema…) -> false, nunca se confunde con colisión de código", () => {
    expect(esDuplicadoCodigoPlan({ code: "ER_NO_REFERENCED_ROW_2" })).toBe(false);
    expect(esDuplicadoCodigoPlan(new Error("timeout"))).toBe(false);
    expect(esDuplicadoCodigoPlan(null)).toBe(false);
    expect(esDuplicadoCodigoPlan(undefined)).toBe(false);
    expect(esDuplicadoCodigoPlan("string cualquiera")).toBe(false);
  });
});

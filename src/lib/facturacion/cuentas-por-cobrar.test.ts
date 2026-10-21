import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { listarCuentasPorCobrar } from "./cuentas-por-cobrar";

/**
 * M-2a — tolerancia de esquema: sin las columnas FACT-4 (entidad, condición, retención) se lee el modelo base. Nunca DDL.
 */
const errCol = Object.assign(new Error("Unknown column"), { errno: 1054, code: "ER_BAD_FIELD_ERROR" });
const sqls = () => vi.mocked(query).mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.mocked(query).mockReset();
});

describe("M-2a · modelo base (sin FACT-4)", () => {
  it("lee sin cont_entidades ni columnas FACT-4; entidad = «Sin entidad»; sin condición ni retención", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (/LIMIT 0/.test(s) && /entidad_id, condicion_pago/.test(s)) throw errCol;
      if (/FROM fact_facturas f/.test(s) && /LIMIT \? OFFSET \?/.test(s)) {
        return [{ id: 1, cliente_id: 3, cliente: "Alfa", numero_factura: "F-1", fecha_emision: "2026-09-01", monto_total: "1000.00", estado_admin: "Emitida", total_pagado: "400.00", cantidad_pagos: 1, ultima_fecha: "2026-09-02" }];
      }
      if (/GROUP BY 1/.test(s)) return [{ entidad_id: null, entidad_nombre: null, cantidad: 1, monto_original: "1000.00", total_pagado: "400.00", saldo: "600.00" }];
      return [];
    }) as never);
    const r = await listarCuentasPorCobrar(7, { vista: "cartera" });
    expect(r.filas[0]).toMatchObject({ entidad: "Sin entidad", entidadId: null, condicionPago: null, retencionEsperada: null, saldoInformativo: "600.00", estadoFinanciero: "PARCIAL" });
    expect(r.totalReal).toBe(1);
    const todo = sqls().filter((x) => !/LIMIT 0/.test(x)).join(" | "); // sin las sondas de esquema
    expect(todo).not.toMatch(/cont_entidades|condicion_pago, retencion|e\.nombre/);
    expect(todo).not.toMatch(/cont_cxc/i);
  });

  it("filtro por entidad concreta sin FACT-4 no devuelve nada (no mezcla ni asigna)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      const s = String(sql);
      if (/LIMIT 0/.test(s) && /entidad_id, condicion_pago/.test(s)) throw errCol;
      return [];
    }) as never);
    await listarCuentasPorCobrar(7, { vista: "historial", entidad: 1 });
    expect(sqls().some((s) => /1 = 0/.test(s))).toBe(true);
  });

  it("la empresa es siempre el primer parámetro de la subconsulta de pagos y del WHERE", async () => {
    vi.mocked(query).mockImplementation((async () => []) as never);
    await listarCuentasPorCobrar(42, { vista: "cartera", clienteId: 5 });
    const principal = vi.mocked(query).mock.calls.find((c) => /LIMIT \? OFFSET \?/.test(String(c[0])))!;
    const params = principal[1] as unknown[];
    expect(params[0]).toBe(42); // fact_pagos.empresa_id = ?
    expect(params[1]).toBe(42); // f.empresa_id = ?
    expect(params.slice(-2)).toEqual([25, 0]);
  });
});

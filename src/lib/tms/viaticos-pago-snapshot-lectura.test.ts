import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { derivarCuentaMostrable, listarViaticosPorPagar } from "./viaticos";

/**
 * VIATICOS-PAGO-SNAPSHOT-1 (lectura) — derivarCuentaMostrable() es la
 * regla CENTRALIZADA de qué cuenta mostrar: cuenta viva mientras el
 * viático no está pagado por TRANSFERENCIA (AUTORIZADO, o cualquier
 * estado con CHEQUE/EFECTIVO — ninguno de los dos usa snapshot), y el
 * snapshot congelado una vez ENTREGADO/LIQUIDADO por TRANSFERENCIA —
 * NUNCA fallback silencioso a la cuenta viva si el snapshot es null
 * (histórico anterior a esta funcionalidad).
 */

const BASE = {
  banco: "Banco Viejo", cuentaBancaria: "111", tipoCuenta: "Monetaria",
  pagoBanco: "Banco Nuevo", pagoCuentaBancaria: "999", pagoTipoCuenta: "Ahorro",
};

describe("derivarCuentaMostrable", () => {
  it("24) AUTORIZADO usa cuenta VIVA (todavía no se pagó, no existe snapshot que mostrar)", () => {
    const r = derivarCuentaMostrable({ ...BASE, estado: "AUTORIZADO", metodoPago: "TRANSFERENCIA" });
    expect(r).toEqual({ bancoMostrar: "Banco Viejo", cuentaBancariaMostrar: "111", tipoCuentaMostrar: "Monetaria", cuentaHistoricaNoDisponible: false });
  });

  it("25) ENTREGADO + TRANSFERENCIA usa el SNAPSHOT, nunca la cuenta viva", () => {
    const r = derivarCuentaMostrable({ ...BASE, estado: "ENTREGADO", metodoPago: "TRANSFERENCIA" });
    expect(r).toEqual({ bancoMostrar: "Banco Nuevo", cuentaBancariaMostrar: "999", tipoCuentaMostrar: "Ahorro", cuentaHistoricaNoDisponible: false });
  });

  it("26) LIQUIDADO + TRANSFERENCIA usa el SNAPSHOT, nunca la cuenta viva", () => {
    const r = derivarCuentaMostrable({ ...BASE, estado: "LIQUIDADO", metodoPago: "TRANSFERENCIA" });
    expect(r).toEqual({ bancoMostrar: "Banco Nuevo", cuentaBancariaMostrar: "999", tipoCuentaMostrar: "Ahorro", cuentaHistoricaNoDisponible: false });
  });

  it("27) un cambio posterior de la cuenta viva del empleado no afecta el histórico mostrado — la función ni siquiera necesita distinguir 'antes/después', solo lee el snapshot ya congelado", () => {
    // Simula: la cuenta viva YA cambió (banco/cuentaBancaria distintos del
    // snapshot) — ENTREGADO+TRANSFERENCIA sigue devolviendo el snapshot,
    // ignorando por completo los campos "vivos" recibidos.
    const r = derivarCuentaMostrable({
      estado: "ENTREGADO", metodoPago: "TRANSFERENCIA",
      banco: "Banco Cambiado Después", cuentaBancaria: "555-nueva-cuenta", tipoCuenta: "Monetaria",
      pagoBanco: "Banco Nuevo", pagoCuentaBancaria: "999", pagoTipoCuenta: "Ahorro",
    });
    expect(r.bancoMostrar).toBe("Banco Nuevo");
    expect(r.cuentaBancariaMostrar).toBe("999");
  });

  it("28) histórico antiguo (ENTREGADO+TRANSFERENCIA, snapshot NULL) NUNCA hace fallback a la cuenta viva — se marca no disponible", () => {
    const r = derivarCuentaMostrable({
      estado: "LIQUIDADO", metodoPago: "TRANSFERENCIA",
      banco: "Banco Viejo", cuentaBancaria: "111", tipoCuenta: "Monetaria",
      pagoBanco: null, pagoCuentaBancaria: null, pagoTipoCuenta: null,
    });
    expect(r).toEqual({ bancoMostrar: null, cuentaBancariaMostrar: null, tipoCuentaMostrar: null, cuentaHistoricaNoDisponible: true });
  });

  it("29) CHEQUE nunca intenta usar snapshot bancario (aunque el estado sea ENTREGADO/LIQUIDADO) — siempre cuenta viva, igual que antes", () => {
    const entregado = derivarCuentaMostrable({ ...BASE, estado: "ENTREGADO", metodoPago: "CHEQUE" });
    const liquidado = derivarCuentaMostrable({ ...BASE, estado: "LIQUIDADO", metodoPago: "CHEQUE" });
    expect(entregado.cuentaBancariaMostrar).toBe("111");
    expect(liquidado.cuentaBancariaMostrar).toBe("111");
    expect(entregado.cuentaHistoricaNoDisponible).toBe(false);
  });

  it("30) EFECTIVO nunca intenta usar snapshot bancario — siempre cuenta viva, igual que antes", () => {
    const r = derivarCuentaMostrable({ ...BASE, estado: "LIQUIDADO", metodoPago: "EFECTIVO" });
    expect(r).toEqual({ bancoMostrar: "Banco Viejo", cuentaBancariaMostrar: "111", tipoCuentaMostrar: "Monetaria", cuentaHistoricaNoDisponible: false });
  });

  it("metodoPago null (viático nunca entregado por ningún método) -> cuenta viva, nunca revienta", () => {
    const r = derivarCuentaMostrable({ ...BASE, estado: "AUTORIZADO", metodoPago: null });
    expect(r.cuentaBancariaMostrar).toBe("111");
  });
});

describe("listarViaticosPorPagar — trae snapshot y calcula los campos *Mostrar (sin N+1)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("31/32/33) el SELECT trae pago_banco/pago_cuenta_bancaria/pago_tipo_cuenta en la MISMA consulta (una sola query)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarViaticosPorPagar(7, {});
    expect(query).toHaveBeenCalledTimes(1);
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("v.pago_banco");
    expect(String(sql)).toContain("v.pago_cuenta_bancaria");
    expect(String(sql)).toContain("v.pago_tipo_cuenta");
  });

  it("ENTREGADO + TRANSFERENCIA con snapshot -> el item devuelto usa el snapshot en los campos *Mostrar", async () => {
    vi.mocked(query).mockResolvedValue([{
      id: 10, plan_id: 1, monto_asignado: "500", estado: "ENTREGADO", metodo_pago: "TRANSFERENCIA", referencia_pago: "REF-1",
      rol: "Piloto", pago_banco: "Banco Nuevo", pago_cuenta_bancaria: "999", pago_tipo_cuenta: "Ahorro",
      plan_codigo: "PLAN-1", fecha_plan: "2026-08-01", personal_codigo: "EMP-1", personal_nombre: "Carlos Ruiz",
      banco: "Banco Viejo", cuenta_bancaria: "111", tipo_cuenta: "Monetaria",
    }] as never);
    const items = await listarViaticosPorPagar(7, { estado: "ENTREGADO" });
    expect(items[0].bancoMostrar).toBe("Banco Nuevo");
    expect(items[0].cuentaBancariaMostrar).toBe("999");
    expect(items[0].cuentaHistoricaNoDisponible).toBe(false);
    // Los campos vivos siguen expuestos aparte (para AUTORIZADO/comparación) — nunca se pierden.
    expect(items[0].banco).toBe("Banco Viejo");
  });

  it("34) histórico viejo (ENTREGADO+TRANSFERENCIA, pago_cuenta_bancaria NULL) -> cuentaHistoricaNoDisponible=true, sin fallback vivo", async () => {
    vi.mocked(query).mockResolvedValue([{
      id: 10, plan_id: 1, monto_asignado: "500", estado: "LIQUIDADO", metodo_pago: "TRANSFERENCIA", referencia_pago: "REF-1",
      rol: "Piloto", pago_banco: null, pago_cuenta_bancaria: null, pago_tipo_cuenta: null,
      plan_codigo: "PLAN-1", fecha_plan: "2026-08-01", personal_codigo: "EMP-1", personal_nombre: "Carlos Ruiz",
      banco: "Banco Viejo", cuenta_bancaria: "111", tipo_cuenta: "Monetaria",
    }] as never);
    const items = await listarViaticosPorPagar(7, { estado: "LIQUIDADO" });
    expect(items[0].cuentaHistoricaNoDisponible).toBe(true);
    expect(items[0].cuentaBancariaMostrar).toBeNull();
  });

  it("AUTORIZADO sigue mostrando la cuenta viva tal cual (sin cambios de comportamiento)", async () => {
    vi.mocked(query).mockResolvedValue([{
      id: 10, plan_id: 1, monto_asignado: "500", estado: "AUTORIZADO", metodo_pago: null, referencia_pago: null,
      rol: "Piloto", pago_banco: null, pago_cuenta_bancaria: null, pago_tipo_cuenta: null,
      plan_codigo: "PLAN-1", fecha_plan: "2026-08-01", personal_codigo: "EMP-1", personal_nombre: "Carlos Ruiz",
      banco: "Banco Viejo", cuenta_bancaria: "111", tipo_cuenta: "Monetaria",
    }] as never);
    const items = await listarViaticosPorPagar(7, { estado: "AUTORIZADO" });
    expect(items[0].cuentaBancariaMostrar).toBe("111");
    expect(items[0].cuentaHistoricaNoDisponible).toBe(false);
  });
});

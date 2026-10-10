import { describe, expect, it } from "vitest";
import { calcularLineasFactura } from "./lineas-factura";
import { calcularRetencionIva, proponerPartidaVenta, type EntradaPartidaVenta } from "./poliza-venta";

const lineaIncluida = (total: number, clasificacion: "SERVICIO" | "BIEN" = "SERVICIO") => {
  const r = calcularLineasFactura({
    lineas: [{ planIds: [1], cantidad: 1, descripcion: "x", precioUnitario: total, clasificacion, precioIncluyeIva: true }],
    planIdsFactura: [1],
  });
  if (!r.ok) throw new Error(r.error);
  return r.lineas[0];
};
const partida = (e: EntradaPartidaVenta) => {
  const r = proponerPartidaVenta(e);
  if (!r.ok) throw new Error(r.error);
  return r.partida;
};

describe("regla CONFIRMADA: venta de Q3,000 con IVA incluido y retención del 15 %", () => {
  const l = lineaIncluida(3000);

  it("la línea desglosa 2,678.57 + 321.43 = 3,000.00", () => {
    expect([l.base, l.iva, l.total]).toEqual([2678.57, 321.43, 3000]);
  });

  it("a CRÉDITO: DEBE Retención IVA 48.21 + Clientes 2,951.79 · HABER Ventas 2,678.57 + IVA por pagar 321.43 (3,000.00 = 3,000.00)", () => {
    const p = partida({ lineas: [l], condicionPago: "CREDITO", retencionIvaPct: 15 });
    expect(p.renglones).toEqual([
      { rol: "RETENCION_IVA", lado: "DEBE", monto: 48.21 },
      { rol: "CLIENTES", lado: "DEBE", monto: 2951.79 },
      { rol: "VENTAS_SERVICIOS", lado: "HABER", monto: 2678.57 },
      { rol: "IVA_POR_PAGAR", lado: "HABER", monto: 321.43 },
    ]);
    expect([p.totalDebe, p.totalHaber, p.retencionIva, p.netoCobrar]).toEqual([3000, 3000, 48.21, 2951.79]);
  });

  it("al CONTADO: la contrapartida neta es el BANCO de la cuenta elegida (no Clientes)", () => {
    const p = partida({ lineas: [l], condicionPago: "CONTADO", cuentaBancariaId: 7, retencionIvaPct: 15 });
    expect(p.renglones[1]).toEqual({ rol: "BANCOS", lado: "DEBE", monto: 2951.79, cuentaBancariaId: 7 });
    expect(p.renglones.some((r) => r.rol === "CLIENTES")).toBe(false);
  });

  it("la retención NO reduce Ventas ni el IVA por pagar: son los mismos con 0 %, 15 % y 30 %", () => {
    const base = (pct: number) => partida({ lineas: [l], condicionPago: "CREDITO", retencionIvaPct: pct }).renglones.filter((r) => r.lado === "HABER");
    expect(base(15)).toEqual(base(0));
    expect(base(30)).toEqual(base(0));
  });

  it("30 %: retención 96.43 (321.43 × 0.30 = 96.429 → half-up) y neto 2,903.57", () => {
    const p = partida({ lineas: [l], condicionPago: "CREDITO", retencionIvaPct: 30 });
    expect([p.retencionIva, p.netoCobrar]).toEqual([96.43, 2903.57]);
    expect(p.totalDebe).toBe(3000);
  });

  it("0 %: no hay renglón de retención y todo el total va a Clientes/Banco", () => {
    const p = partida({ lineas: [l], condicionPago: "CREDITO", retencionIvaPct: 0 });
    expect(p.renglones.map((r) => r.rol)).toEqual(["CLIENTES", "VENTAS_SERVICIOS", "IVA_POR_PAGAR"]);
    expect(p.netoCobrar).toBe(3000);
  });
});

describe("ventas por SERVICIOS y por BIENES; IVA mixto", () => {
  it("separa las ventas por clasificación y el IVA por pagar es el de TODA la factura", () => {
    const r = calcularLineasFactura({
      lineas: [
        { planIds: [1], cantidad: 1, descripcion: "flete", precioUnitario: 1120, clasificacion: "SERVICIO", precioIncluyeIva: true },
        { planIds: [2], cantidad: 2, descripcion: "tarima", precioUnitario: 100, clasificacion: "BIEN", precioIncluyeIva: false },
      ],
      planIdsFactura: [1, 2],
    });
    if (!r.ok) throw new Error(r.error);
    const p = partida({ lineas: r.lineas, condicionPago: "CREDITO", retencionIvaPct: 15 });
    // servicios: 1120 con IVA incluido → base 1000, IVA 120; bienes: 2×100 = 200 + IVA agregado 24 → total 224
    expect(p.renglones).toContainEqual({ rol: "VENTAS_SERVICIOS", lado: "HABER", monto: 1000 });
    expect(p.renglones).toContainEqual({ rol: "VENTAS_BIENES", lado: "HABER", monto: 200 });
    expect(p.renglones).toContainEqual({ rol: "IVA_POR_PAGAR", lado: "HABER", monto: 144 });
    expect(p.totalHaber).toBe(1344);
    expect(p.retencionIva).toBe(21.6); // 144 × 15 %
    expect(p.totalDebe).toBe(1344);
  });
});

describe("múltiples líneas con IVA incluido y agregado: la retención se calcula sobre el IVA TOTAL de la factura", () => {
  const lineasMixtas = () => {
    const r = calcularLineasFactura({
      lineas: [
        { planIds: [1], cantidad: 1, descripcion: "a", precioUnitario: 100, clasificacion: "SERVICIO", precioIncluyeIva: true },
        { planIds: [2], cantidad: 1, descripcion: "b", precioUnitario: 33.33, clasificacion: "SERVICIO", precioIncluyeIva: true },
        { planIds: [3], cantidad: 1, descripcion: "c", precioUnitario: 50, clasificacion: "BIEN", precioIncluyeIva: false },
      ],
      planIdsFactura: [1, 2, 3],
    });
    if (!r.ok) throw new Error(r.error);
    return r.lineas;
  };

  it("IVA por línea 10.71 + 3.57 + 6.00 = 20.28; total 189.33", () => {
    const ls = lineasMixtas();
    expect(ls.map((l) => l.iva)).toEqual([10.71, 3.57, 6]);
    expect(ls.reduce((s, l) => Math.round((s + l.total) * 100) / 100, 0)).toBe(189.33);
  });

  it("15 %: retención 3.04 (20.28 × 0.15 = 3.042), no 3.05 (redondear línea por línea); neto 186.29; cuadra", () => {
    const p = partida({ lineas: lineasMixtas(), condicionPago: "CREDITO", retencionIvaPct: 15 });
    expect(p.retencionIva).toBe(3.04);
    expect(p.netoCobrar).toBe(186.29);
    expect([p.totalDebe, p.totalHaber]).toEqual([189.33, 189.33]);
    expect(p.renglones).toContainEqual({ rol: "VENTAS_SERVICIOS", lado: "HABER", monto: 119.05 });
    expect(p.renglones).toContainEqual({ rol: "VENTAS_BIENES", lado: "HABER", monto: 50 });
    expect(p.renglones).toContainEqual({ rol: "IVA_POR_PAGAR", lado: "HABER", monto: 20.28 });
  });

  it("30 %: retención 6.08 y neto 183.25; sin retención: neto = total", () => {
    expect(partida({ lineas: lineasMixtas(), condicionPago: "CREDITO", retencionIvaPct: 30 })).toMatchObject({ retencionIva: 6.08, netoCobrar: 183.25 });
    expect(partida({ lineas: lineasMixtas(), condicionPago: "CREDITO", retencionIvaPct: 0 })).toMatchObject({ retencionIva: 0, netoCobrar: 189.33 });
  });
});

describe("validaciones", () => {
  const l = lineaIncluida(1120);
  it("exige condición de pago, banco al contado, retención válida y líneas clasificadas", () => {
    expect(proponerPartidaVenta({ lineas: [l], condicionPago: null, retencionIvaPct: 0 })).toMatchObject({ ok: false });
    expect(proponerPartidaVenta({ lineas: [l], condicionPago: "CONTADO", retencionIvaPct: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("cuenta bancaria") });
    expect(proponerPartidaVenta({ lineas: [l], condicionPago: "CREDITO", retencionIvaPct: 10 })).toMatchObject({ ok: false });
    expect(proponerPartidaVenta({ lineas: [{ ...l, clasificacion: null }], condicionPago: "CREDITO", retencionIvaPct: 0 })).toMatchObject({ ok: false, error: expect.stringContaining("SERVICIO o BIEN") });
    expect(proponerPartidaVenta({ lineas: [], condicionPago: "CREDITO", retencionIvaPct: 0 })).toMatchObject({ ok: false });
  });

  it("calcularRetencionIva: solo 0/15/30 y nunca negativa", () => {
    expect(calcularRetencionIva(321.43, 15)).toBe(48.21);
    expect(calcularRetencionIva(0, 30)).toBe(0);
    expect(() => calcularRetencionIva(100, 12)).toThrow(RangeError);
    expect(() => calcularRetencionIva(-1, 15)).toThrow(RangeError);
  });

  it("la partida siempre cuadra al centavo en un barrido de importes y porcentajes", () => {
    for (const total of [0.01, 1, 33.33, 99.99, 100, 112.5, 1234.56, 9999.99, 54321.09]) {
      const li = lineaIncluida(total);
      for (const pct of [0, 15, 30]) {
        const p = partida({ lineas: [li], condicionPago: "CREDITO", retencionIvaPct: pct });
        expect(p.totalDebe, `${total}/${pct}`).toBe(p.totalHaber);
        expect(p.totalDebe).toBe(li.total);
      }
    }
  });
});

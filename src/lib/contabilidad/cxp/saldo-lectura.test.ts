import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CxpSituacionFactura } from "@/components/contabilidad/cxp-situacion-factura";
import { desgloseFacturaLectura } from "./saldo-lectura";
import { calcularSaldo, desgloseFinanciero } from "./saldo";

const factura = { totalDocumento: "112.00", isrMonto: "5.00", totalNetoPagar: "107.00" };
describe("desglose de lectura separado de las invariantes de escritura", () => {
  it.each(["0.00", "50.01", "107.00"])("reutiliza exactamente el desglose estricto para aplicado %s", aplicado => {
    expect(desgloseFacturaLectura(1, "REGISTRADA", factura, aplicado)).toEqual({ ...desgloseFinanciero("REGISTRADA", factura, aplicado), excesoAplicado: "0.00", advertenciasIntegridad: [] });
  });
  it("no compensa, redondea ni cambia la factura al informar un exceso de un centavo", () => {
    const original = { ...factura };
    const fin = desgloseFacturaLectura(1, "REGISTRADA", factura, "107.01");
    expect(factura).toEqual(original);
    expect(fin).toMatchObject({ totalDocumento: "112.00", retencionIsr: "5.00", montoPagadero: "107.00", pagado: "107.01", excesoAplicado: "0.01", saldo: null, estadoFinanciero: "SOBREAPLICADA" });
    expect(fin.advertenciasIntegridad[0].detalle).toEqual({ montoPagadero: "107.00", pagado: "107.01", exceso: "0.01" });
    expect(() => calcularSaldo(factura, "107.01")).toThrow(RangeError);
    expect(() => desgloseFinanciero("REGISTRADA", factura, "107.01")).toThrow(RangeError);
  });
  it("no transforma errores DECIMAL desconocidos en importes cero", () => {
    expect(() => desgloseFacturaLectura(1, "REGISTRADA", factura, "inválido")).toThrow();
  });
  it("anulada con exceso conserva ambas advertencias sin presentarla como pagada", () => {
    const fin = desgloseFacturaLectura(1, "ANULADA", factura, "120.00");
    expect(fin.estadoFinanciero).toBe("ANULADA"); expect(fin.saldo).toBeNull();
    expect(fin.advertenciasIntegridad.map(a => a.codigo)).toEqual(["SOBREAPLICACION", "PAGO_VIGENTE_EN_ANULADA"]);
  });
});

describe("presentación de integridad en facturas", () => {
  it("renderiza advertencia visible, etiqueta sobreaplicada y exceso exacto sin crédito", () => {
    const html = renderToStaticMarkup(createElement(CxpSituacionFactura, { factura: desgloseFacturaLectura(1, "REGISTRADA", factura, "107.01") }));
    expect(html).toContain("Sobreaplicada"); expect(html).toContain('role="alert"');
    expect(html).toContain("SOBREAPLICACION"); expect(html).toContain("exceso 0.01");
    expect(html).toContain("no representa saldo a favor del proveedor");
    expect(html).not.toContain(">Pagada<");
  });
  it("anulada con pago se rotula como tal y conserva advertencia", () => {
    const html = renderToStaticMarkup(createElement(CxpSituacionFactura, { factura: desgloseFacturaLectura(1, "ANULADA", factura, "1.00") }));
    expect(html).toContain("Anulada"); expect(html).toContain("PAGO_VIGENTE_EN_ANULADA");
  });
  it("una pagada válida no presenta advertencias", () => {
    const html = renderToStaticMarkup(createElement(CxpSituacionFactura, { factura: desgloseFacturaLectura(1, "REGISTRADA", factura, "107.00") }));
    expect(html).toBe("Pagada");
  });
  it("el listado no formatea null como Q0 y no ofrece Pagar saldo sobre null", () => {
    const source = readFileSync("src/components/contabilidad/cxp-client.tsx", "utf8");
    expect(source).toContain('x.saldo === null ? "Revisión de integridad pendiente" : q(x.saldo)');
    expect(source).toContain("<CxpSituacionFactura factura={x} />");
    expect(source).toContain("x.saldo !== null && Number(x.saldo) > 0");
    expect(source).toContain("disabled={x.saldo === null}");
  });
});

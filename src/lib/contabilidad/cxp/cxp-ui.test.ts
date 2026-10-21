import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CxpClient } from "@/components/contabilidad/cxp-client";

const props = { slug: "e", puedeVer: true, puedeRegistrar: true, puedeAnular: true, puedeVerFiscal: true, puedeEditarFiscal: true };
const src = readFileSync("src/components/contabilidad/cxp-client.tsx", "utf8");

describe("UI de Cuentas por pagar (M-3A/M-3B1)", () => {
  it("rotula el alcance: informativo, sin pólizas, retención no es pago, y lo que sigue bloqueado", () => {
    const html = renderToStaticMarkup(createElement(CxpClient, props));
    expect(html).toContain("Cuentas por pagar");
    expect(html).toMatch(/no genera pólizas/);
    expect(html).toMatch(/no es un pago al proveedor/);
    expect(html).toMatch(/Siguen bloqueados, sin regla confirmada/);
    expect(html).toMatch(/factura especial y retención de IVA/);
    expect(html).toContain("Seleccionar entidad");
  });
  it("no ofrece acciones ni tabs sin permiso", () => {
    const html = renderToStaticMarkup(createElement(CxpClient, { ...props, puedeVer: false, puedeRegistrar: false, puedeAnular: false, puedeVerFiscal: false, puedeEditarFiscal: false }));
    expect(html).not.toContain("Anular");
    expect(html).not.toContain("Registrar factura de proveedor");
    expect(html).not.toContain("Registrar pago");
  });
  it("el cliente no calcula ISR ni saldos: solo muestra lo que devuelve el servidor", () => {
    expect(src).not.toMatch(/\*\s*0\.0[57]|Decimal|isrMonto\s*[-*]|totalDocumento\s*-|montoPagadero\s*-|totalNetoPagar\s*-/);
    expect(src).toContain("/facturas/preview");
    for (const campo of ["retencionIsr", "montoPagadero", "pagado", "saldo"]) expect(src).toContain(`x.${campo}`);
  });
  it("la tabla de facturas distingue valor neto, IVA, total, retención ISR, monto pagadero, pagado y saldo", () => {
    for (const t of ['"Valor neto"', '"IVA"', '"Total"', '"Retención ISR"', '"Monto pagadero"', '"Pagado"', '"Saldo"']) expect(src).toContain(t);
  });
  it("el desglose previo al registro muestra neto, IVA, total, retención (restando) y monto pagadero", () => {
    for (const t of ["Valor neto (sin IVA)", "Total de la factura", "Retención de ISR", "Monto pagadero al proveedor"]) expect(src).toContain(t);
    expect(src).toContain("− {q(calculo.isrMonto)}");
  });
  it("pagos: un pago a varias facturas de un proveedor, clave de idempotencia por formulario, sin enviar total ni empresa", () => {
    expect(src).toContain("claveIdempotencia: clave");
    expect(src).toContain("aplicaciones");
    expect(src).toContain("{ ...f, proveedorId: Number(f.proveedorId), claveIdempotencia: clave, aplicaciones }"); // el cuerpo no trae total, empresa ni usuario
    expect(src).not.toMatch(/empresaId/);
    expect(src).toContain("Pagar saldo");
    expect(src).toContain("Reversar");
  });
  it("la pestaña Pagos solo aparece con permiso de ver pagos; registrar y reversar con sus permisos propios", () => {
    expect(src).toMatch(/puedeVerPagos && <button[\s\S]*?>Pagos<\/button>/);
    expect(src).toMatch(/puedeRegistrar && <fieldset[^>]*>\s*<legend[^>]*>Registrar pago a proveedor/);
    expect(src).toMatch(/puedeReversar && p\.estado === "REGISTRADO"/);
  });
});

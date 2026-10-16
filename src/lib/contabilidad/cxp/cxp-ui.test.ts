import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CxpClient } from "@/components/contabilidad/cxp-client";

const props = { slug: "e", puedeVer: true, puedeRegistrar: true, puedeAnular: true, puedeVerFiscal: true, puedeEditarFiscal: true };

describe("UI de Cuentas por pagar (M-3A)", () => {
  it("rotula el alcance: informativo, sin pólizas y con la regla ISR ≥ Q30,000 pendiente", () => {
    const html = renderToStaticMarkup(createElement(CxpClient, props));
    expect(html).toContain("Cuentas por pagar");
    expect(html).toMatch(/no genera pólizas/);
    expect(html).toMatch(/Q30,000\.00 está pendiente/);
    expect(html).toContain("Seleccionar entidad");
  });
  it("no ofrece acciones ni tabs sin permiso", () => {
    const html = renderToStaticMarkup(createElement(CxpClient, { ...props, puedeVer: false, puedeRegistrar: false, puedeAnular: false, puedeVerFiscal: false, puedeEditarFiscal: false }));
    expect(html).not.toContain("Anular");
    expect(html).not.toContain("Registrar factura de proveedor");
  });
  it("el cliente no calcula ISR ni saldos: solo muestra lo que devuelve el servidor", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/contabilidad/cxp-client.tsx", "utf8");
    expect(src).not.toMatch(/\*\s*0\.05|\/\s*100|Decimal/);
    expect(src).toContain("/facturas/preview");
  });
});

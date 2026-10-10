import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BloqueoFact4 } from "./factura-formulario";

/**
 * FACT-4 — sin fallback silencioso en la pantalla: si falta la migración (o no se pudo leer el contexto) NO se ofrece ningún
 * formulario para crear/editar; se muestra un bloqueo explícito. El servidor ya responde 503 a esas mutaciones.
 */
const src = readFileSync(join(__dirname, "factura-formulario.tsx"), "utf-8");
const noop = () => undefined;

describe("Bloqueo FACT-4 (migración ausente)", () => {
  it("explica que falta la migración, que no se guardó nada y NO ofrece guardar ni reintentar", () => {
    const html = renderToStaticMarkup(createElement(BloqueoFact4, { errorContexto: false, onReintentar: noop, onCancelar: noop }));
    expect(html).toContain("falta aplicar la migración FACT-4");
    expect(html).toContain("No se guardó nada");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Guardar borrador");
    expect(html).not.toContain("Reintentar");
    expect(html).toContain("Volver");
  });

  it("si solo falló la lectura del contexto, ofrece Reintentar (no un formulario)", () => {
    const html = renderToStaticMarkup(createElement(BloqueoFact4, { errorContexto: true, onReintentar: noop, onCancelar: noop }));
    expect(html).toContain("No se pudo cargar la información necesaria");
    expect(html).toContain("Reintentar");
    expect(html).not.toContain("Guardar borrador");
  });

  it("el punto de entrada ya NO importa ni renderiza el formulario del modelo anterior", () => {
    expect(src).not.toContain("FacturaBorradorForm");
    expect(src).toContain("FacturaLineasForm");
    expect(src).toContain("BloqueoFact4");
  });

  it("las dos pantallas que crean/editan usan el punto de entrada con bloqueo, no el formulario anterior", () => {
    for (const f of ["facturas-panel.tsx", "viajes-pendientes-panel.tsx"]) {
      const s = readFileSync(join(__dirname, f), "utf-8");
      expect(s, f).toContain("<FacturaFormulario");
      expect(s, f).not.toContain("<FacturaBorradorForm");
    }
  });
});

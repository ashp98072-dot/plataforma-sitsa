import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(resolve(process.cwd(), ruta), "utf8");

describe("confirmación de autorización en Gastos y Fondos", () => {
  it("el modal presenta las dos decisiones requeridas", () => {
    const modal = leer("src/components/tms/autorizacion-confirmacion-modal.tsx");
    expect(modal).toContain(">Cancelar</button>");
    expect(modal).toContain('"Confirmar autorización"');
    expect(modal).toContain("disabled={procesando}");
  });

  it("Gastos solicita confirmación con el mensaje exacto", () => {
    const pagina = leer("src/app/e/[slug]/gastos/page.tsx");
    expect(pagina).toContain("¿Está seguro de que desea autorizar este gasto operativo?");
    expect(pagina).toContain("setConfirmandoAutorizacionId(g.id)");
  });

  it("Fondos solicita confirmación con el mensaje exacto", () => {
    const pagina = leer("src/app/e/[slug]/fondos/page.tsx");
    expect(pagina).toContain("¿Está seguro de que desea autorizar esta solicitud de fondo?");
    expect(pagina).toContain("setConfirmandoAutorizacionId(s.id)");
  });
});

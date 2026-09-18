import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { RequerimientoDecisionClient, formatearTimestampCompra } from "./requerimiento-decision-client";

/**
 * COMPRAS-FASE-4-AUTORIZACION — mismo patrón renderToStaticMarkup ya usado
 * en requerimiento-ui.test.ts/linea-documentos-client.test.ts.
 */
function render() {
  return renderToStaticMarkup(createElement(RequerimientoDecisionClient, { slug: "a", requerimientoId: 12, version: 3 }));
}

describe("RequerimientoDecisionClient — estructura estática", () => {
  it("muestra los botones Autorizar y Rechazar", () => {
    const html = render();
    expect(html).toContain("Autorizar");
    expect(html).toContain("Rechazar");
  });

  it("el formulario de motivo de rechazo arranca oculto (mostrarRechazo inicial = false)", () => {
    const html = render();
    expect(html).not.toContain("Motivo del rechazo");
    expect(html).not.toContain("Confirmar rechazo");
  });
});

describe("formatearTimestampCompra — formateador local, sin instanciar Date", () => {
  it("YYYY-MM-DD HH:mm:ss -> DD/MM/YYYY HH:mm:ss", () => {
    expect(formatearTimestampCompra("2026-09-18 12:00:00")).toBe("18/09/2026 12:00:00");
  });
  it("null/undefined -> '—'", () => {
    expect(formatearTimestampCompra(null)).toBe("—");
    expect(formatearTimestampCompra(undefined)).toBe("—");
  });
  it("nunca se desfasa por timezone (no usa new Date(), solo reordena el string tal cual llega de MySQL/DATE_FORMAT)", () => {
    // Mismo caso que el bug real de RRHH-FECHAS-DATE-TIMEZONE, pero aquí
    // no puede reproducirse: no hay ningún new Date(string) de por medio.
    expect(formatearTimestampCompra("2026-06-15 00:00:00")).toBe("15/06/2026 00:00:00");
  });
});

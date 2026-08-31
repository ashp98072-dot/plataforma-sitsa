import { describe, expect, it } from "vitest";
import {
  abreviarHash,
  etiquetaAccion,
  etiquetaMetodo,
  etiquetaOrigenFirma,
  formatearFechaFirma,
} from "./historial-firmas-ui";

/** VIATICOS-HISTORIAL-FIRMA-1 (ticket item 18) — la UI etiqueta acciones/origen/método correctamente. */

describe("etiquetaAccion", () => {
  it("18) AUTORIZAR_VIATICO -> 'Autorización de viático'", () => {
    expect(etiquetaAccion("AUTORIZAR_VIATICO")).toBe("Autorización de viático");
  });

  it("18) LIQUIDAR_VIATICO -> 'Liquidación de viático'", () => {
    expect(etiquetaAccion("LIQUIDAR_VIATICO")).toBe("Liquidación de viático");
  });

  it("acción desconocida -> se muestra cruda, nunca revienta", () => {
    expect(etiquetaAccion("OTRA_ACCION")).toBe("OTRA_ACCION");
  });
});

describe("etiquetaOrigenFirma", () => {
  it("GUARDADA -> 'Firma guardada'", () => {
    expect(etiquetaOrigenFirma("GUARDADA")).toBe("Firma guardada");
  });

  it("DIBUJADA -> 'Dibujada en el momento'", () => {
    expect(etiquetaOrigenFirma("DIBUJADA")).toBe("Dibujada en el momento");
  });

  it("null (payload viejo) -> 'No disponible', nunca se inventa un origen", () => {
    expect(etiquetaOrigenFirma(null)).toBe("No disponible");
  });
});

describe("etiquetaMetodo", () => {
  it("FIRMA_MANUSCRITA -> 'Firma manuscrita'", () => {
    expect(etiquetaMetodo("FIRMA_MANUSCRITA")).toBe("Firma manuscrita");
  });

  it("PASSWORD -> 'Contraseña + firma' — nunca lenguaje legal/certificado", () => {
    expect(etiquetaMetodo("PASSWORD")).toBe("Contraseña + firma");
    for (const etiqueta of [etiquetaMetodo("PASSWORD"), etiquetaMetodo("FIRMA_MANUSCRITA")]) {
      expect(etiqueta.toLowerCase()).not.toContain("certificad");
      expect(etiqueta.toLowerCase()).not.toContain("legal");
      expect(etiqueta.toLowerCase()).not.toContain("psc");
    }
  });
});

describe("formatearFechaFirma", () => {
  it("formatea una fecha válida como DD/MM/YYYY HH:MM", () => {
    const r = formatearFechaFirma("2026-08-31T08:15:00");
    expect(r).toMatch(/31\/08\/2026/);
  });

  it("fecha no parseable -> devuelve el valor tal cual, nunca 'Invalid Date'", () => {
    expect(formatearFechaFirma("no-es-una-fecha")).toBe("no-es-una-fecha");
  });
});

describe("abreviarHash", () => {
  it("abrevia un hash largo (primeros 8 + últimos 6)", () => {
    const hash = "a".repeat(64);
    expect(abreviarHash(hash)).toBe(`${"a".repeat(8)}…${"a".repeat(6)}`);
  });

  it("hash corto se muestra completo", () => {
    expect(abreviarHash("abc123")).toBe("abc123");
  });
});

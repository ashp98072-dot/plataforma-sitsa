import { describe, expect, it } from "vitest";
import { TIPOS_DOCUMENTO, TIPOS_DOCUMENTO_SELECCIONABLES } from "./documentos-tipos";
import { TIPOS_DOCUMENTO as TIPOS_DOCUMENTO_REEXPORTADO } from "./documentos";

/**
 * RRHH-EXPEDIENTE-TIPO-DOCUMENTO — catálogo único, sin mocks: valida los
 * valores reales que verá producción, no una copia que podría desincronizarse.
 */

describe("TIPOS_DOCUMENTO (catálogo único)", () => {
  it("incluye 'Antecedentes' como tipo válido (el bug corregido)", () => {
    expect(TIPOS_DOCUMENTO).toContain("Antecedentes");
  });

  it("conserva compatibilidad con los tipos históricos existentes", () => {
    expect(TIPOS_DOCUMENTO).toContain("Antecedentes penales");
    expect(TIPOS_DOCUMENTO).toContain("Antecedentes policíacos");
    expect(TIPOS_DOCUMENTO).toContain("DPI");
    expect(TIPOS_DOCUMENTO).toContain("Foto");
    expect(TIPOS_DOCUMENTO).toContain("Contrato");
    expect(TIPOS_DOCUMENTO).toContain("Licencia");
    expect(TIPOS_DOCUMENTO).toContain("Tarjeta de pulmones");
    expect(TIPOS_DOCUMENTO).toContain("Tarjeta de salud");
    expect(TIPOS_DOCUMENTO).toContain("Manipulación de alimentos");
    expect(TIPOS_DOCUMENTO).toContain("IGSS");
    expect(TIPOS_DOCUMENTO).toContain("Boleta permiso");
    expect(TIPOS_DOCUMENTO).toContain("Otro");
  });

  it("src/lib/rrhh/documentos.ts re-exporta el MISMO catálogo (una sola fuente, sin duplicarlo)", () => {
    expect(TIPOS_DOCUMENTO_REEXPORTADO).toBe(TIPOS_DOCUMENTO);
  });
});

describe("TIPOS_DOCUMENTO_SELECCIONABLES (subconjunto del modal de Expediente)", () => {
  it("incluye 'Antecedentes' (antes faltaba, causaba el fallback a 'Otro')", () => {
    expect(TIPOS_DOCUMENTO_SELECCIONABLES).toContain("Antecedentes");
  });

  it("cada valor seleccionable es, por construcción, un valor válido del catálogo único", () => {
    for (const tipo of TIPOS_DOCUMENTO_SELECCIONABLES) {
      expect(TIPOS_DOCUMENTO).toContain(tipo);
    }
  });

  it("no incluye 'Foto' (tiene su propio flujo dedicado, no se ofrece como atajo aquí)", () => {
    expect(TIPOS_DOCUMENTO_SELECCIONABLES).not.toContain("Foto");
  });
});

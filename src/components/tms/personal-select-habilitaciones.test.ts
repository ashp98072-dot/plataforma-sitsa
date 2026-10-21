import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — badge "En capacitación" + advertencia NO bloqueante en
 * PilotoSelect/AuxiliaresSelect. Inspección de fuente (sin harness de componentes, mismo criterio del repo).
 */
const piloto = readFileSync("src/components/tms/piloto-select.tsx", "utf8").replace(/\r\n/g, "\n");
const auxiliares = readFileSync("src/components/tms/auxiliares-select.tsx", "utf8").replace(/\r\n/g, "\n");

describe("PilotoSelect — habilitación en capacitación", () => {
  it("PilotoOpt declara habilitacionEstado opcional", () => {
    expect(piloto).toMatch(/habilitacionEstado\?:\s*"HABILITADO"\s*\|\s*"CAPACITACION"\s*\|\s*null;/);
  });

  it("muestra el badge 'En capacitación' en la opción de la lista", () => {
    expect(piloto).toContain("En capacitación");
  });

  it("la advertencia ⚠ es NO bloqueante: no hay ningún `disabled`/`return` condicionado a habilitacionEstado", () => {
    expect(piloto).toContain("⚠ {seleccionado.nombre} está habilitado como piloto en capacitación.");
    // El único `disabled`/bloqueo de selección sigue siendo por `ocupacion` (disponibilidad), nunca por habilitación.
    expect(piloto).not.toMatch(/disabled=\{.*habilitacionEstado/);
  });
});

describe("AuxiliaresSelect — habilitación en capacitación", () => {
  it("AuxiliarOpt declara habilitacionEstado opcional", () => {
    expect(auxiliares).toMatch(/habilitacionEstado\?:\s*"HABILITADO"\s*\|\s*"CAPACITACION"\s*\|\s*null;/);
  });

  it("muestra el badge 'En capacitación' en la opción de la lista", () => {
    expect(auxiliares).toContain("En capacitación");
  });

  it("la advertencia ⚠ se calcula sobre los YA elegidos (empleadoIds), no bloquea agregar más", () => {
    expect(auxiliares).toContain("const enCapacitacion = empleadoIds");
    expect(auxiliares).toContain('"CAPACITACION"');
    expect(auxiliares).not.toMatch(/disabled=\{.*habilitacionEstado/);
  });
});

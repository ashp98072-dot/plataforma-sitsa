import { describe, expect, it } from "vitest";
import { resolverUnidadViaje, TEXTO_UNIDAD_TERCERIZADO } from "./unidad-viaje";

describe("resolverUnidadViaje — columna «Unidad» de Viajes pendientes", () => {
  it("propio con unidad interna → placa interna", () => {
    expect(resolverUnidadViaje({ tipoViaje: "Propio", placaInterna: "C-101DEM", placaExterna: null })).toBe("C-101DEM");
  });

  it("propio sin unidad → null, y nunca usa la columna externa", () => {
    expect(resolverUnidadViaje({ tipoViaje: "Propio", placaInterna: null, placaExterna: "X-1" })).toBeNull();
    expect(resolverUnidadViaje({ tipoViaje: "Propio", placaInterna: "  ", placaExterna: null })).toBeNull();
  });

  it("tipo_viaje ausente se trata como propio", () => {
    expect(resolverUnidadViaje({ tipoViaje: null, placaInterna: "C-1", placaExterna: "X-1" })).toBe("C-1");
    expect(resolverUnidadViaje({ tipoViaje: undefined, placaInterna: null, placaExterna: "X-1" })).toBeNull();
  });

  it("tercerizado con placa externa → la placa externa (sin espacios sobrantes)", () => {
    expect(resolverUnidadViaje({ tipoViaje: "Tercerizado", placaInterna: null, placaExterna: " TC-555XYZ " })).toBe("TC-555XYZ");
  });

  it("tercerizado sin placa externa → «Tercerizado»", () => {
    for (const placaExterna of [null, undefined, "", "   "]) {
      expect(resolverUnidadViaje({ tipoViaje: "Tercerizado", placaInterna: null, placaExterna })).toBe(TEXTO_UNIDAD_TERCERIZADO);
    }
    expect(TEXTO_UNIDAD_TERCERIZADO).toBe("Tercerizado");
  });

  it("misma regla que Programación: en un tercerizado MANDA la placa externa aunque hubiera un unidad_id huérfano", () => {
    expect(resolverUnidadViaje({ tipoViaje: "Tercerizado", placaInterna: "C-HUERFANA", placaExterna: "TC-555XYZ" })).toBe("TC-555XYZ");
    expect(resolverUnidadViaje({ tipoViaje: "Tercerizado", placaInterna: "C-HUERFANA", placaExterna: null })).toBe("Tercerizado");
  });
});

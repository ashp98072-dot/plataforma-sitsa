import { describe, expect, it } from "vitest";
import { ETIQUETA_TIPO_UNIDAD, TIPOS_UNIDAD, esTc, normalizarTipoUnidad } from "./tipo-unidad";

/**
 * PROGRAMACION-TC-CAJA-REMOLQUE-1 — la clasificación formal de Flota. El TC
 * NUNCA se infiere de placa/marca/modelo/descripción: solo cuenta lo que se
 * clasificó explícitamente en flota_vehiculos.tipo_unidad.
 */
describe("tipo_unidad — catálogo y normalización", () => {
  it("el catálogo es exactamente VEHICULO | CABEZAL | TC, con etiqueta para cada uno", () => {
    expect([...TIPOS_UNIDAD]).toEqual(["VEHICULO", "CABEZAL", "TC"]);
    for (const t of TIPOS_UNIDAD) expect(ETIQUETA_TIPO_UNIDAD[t]).toBeTruthy();
  });

  it.each([
    ["TC", "TC"],
    ["tc", "TC"],
    [" Cabezal ", "CABEZAL"],
    ["VEHICULO", "VEHICULO"],
  ])("normaliza %j -> %s", (entrada, esperado) => {
    expect(normalizarTipoUnidad(entrada)).toBe(esperado);
  });

  it.each([[undefined], [null], [""], ["CAMION"], ["remolque"], [42]])(
    "un valor ausente/desconocido (%j) es 'VEHICULO' — el comportamiento de siempre (fila legada o columna aún sin migrar)",
    (entrada) => {
      expect(normalizarTipoUnidad(entrada)).toBe("VEHICULO");
      expect(esTc(entrada)).toBe(false);
    },
  );

  it("solo 'TC' es TC; un CABEZAL sigue siendo Unidad", () => {
    expect(esTc("TC")).toBe(true);
    expect(esTc("tc")).toBe(true);
    expect(esTc("CABEZAL")).toBe(false);
    expect(esTc("VEHICULO")).toBe(false);
  });

  it("NUNCA clasifica por texto de placa/marca: 'TC-045' como valor de tipo no es TC salvo que sea exactamente 'TC'", () => {
    expect(esTc("TC-045")).toBe(false);
    expect(esTc("caja seca")).toBe(false);
  });
});

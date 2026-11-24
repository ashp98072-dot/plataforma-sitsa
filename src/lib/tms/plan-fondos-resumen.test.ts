import { describe, expect, it } from "vitest";
import { resumenFondosViaje } from "./plan-fondos-resumen";

describe("resumenFondosViaje (resumen visual de Programación)", () => {
  it("ejemplo: Piloto Q50 + Auxiliar Q100 + Auxiliar Q0 + Combustible Q200 = Q350 en tres filas", () => {
    expect(resumenFondosViaje([50, 100, 0], [200])).toEqual({ totalViaticos: 150, totalOtros: 200, totalGeneral: 350, filasViaticos: 2, filasOtros: 1 });
  });
  it("acepta texto de los campos (coma decimal) y descarta vacíos, negativos, no numéricos y Q0 (igual que la sincronización: monto > 0)", () => {
    expect(resumenFondosViaje(["25,50", "", "abc", -5, "0", "10"], ["0.1", "0.2", null, undefined])).toMatchObject({ totalViaticos: 35.5, totalOtros: 0.3, totalGeneral: 35.8, filasViaticos: 2, filasOtros: 2 });
  });
  it("sin datos todo es Q0", () => { expect(resumenFondosViaje([], [])).toEqual({ totalViaticos: 0, totalOtros: 0, totalGeneral: 0, filasViaticos: 0, filasOtros: 0 }); });
});

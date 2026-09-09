import { describe, expect, it } from "vitest";
import { aplicarDefaultsRutaSinSobrescribir } from "./ruta-defaults";

const personal = [
  { empleadoId: 10, empleadoNombre: "Piloto", rol: "Piloto" as const, viaticoMonto: 150 },
  { empleadoId: 20, empleadoNombre: "Aux 1", rol: "Auxiliar" as const, viaticoMonto: 75 },
  { empleadoId: 21, empleadoNombre: "Aux 2", rol: "Auxiliar" as const, viaticoMonto: 80 },
];

const vacio = {
  tarifaComercial: "",
  pilotoEmpleadoId: 0,
  pilotoNombre: "",
  auxiliarEmpleadoIds: [] as number[],
  auxiliarNombres: [] as string[],
  viaticosMontos: {} as Record<string, string>,
};

describe("defaults de ruta en Programación", () => {
  it("precarga tarifa, piloto, varios auxiliares y viáticos en campos vacíos", () => {
    expect(aplicarDefaultsRutaSinSobrescribir(vacio, 1250, personal)).toEqual({
      tarifaComercial: "1250",
      pilotoEmpleadoId: 10,
      pilotoNombre: "Piloto",
      auxiliarEmpleadoIds: [20, 21],
      auxiliarNombres: [],
      viaticosMontos: { piloto: "150", "aux-emp-20": "75", "aux-emp-21": "80" },
    });
  });

  it("no pisa tarifa, piloto, auxiliares ni viáticos manuales", () => {
    const actual = {
      tarifaComercial: "999",
      pilotoEmpleadoId: 99,
      pilotoNombre: "Manual",
      auxiliarEmpleadoIds: [98],
      auxiliarNombres: [],
      viaticosMontos: { piloto: "33", "aux-emp-98": "44" },
    };
    expect(aplicarDefaultsRutaSinSobrescribir(actual, 1250, personal)).toEqual(actual);
  });

  it("preserva auxiliares libres y completa solo el piloto vacío", () => {
    const actual = { ...vacio, auxiliarNombres: ["Auxiliar libre"], viaticosMontos: { piloto: "25" } };
    const result = aplicarDefaultsRutaSinSobrescribir(actual, null, personal);
    expect(result.auxiliarNombres).toEqual(["Auxiliar libre"]);
    expect(result.auxiliarEmpleadoIds).toEqual([]);
    expect(result.pilotoEmpleadoId).toBe(10);
    expect(result.viaticosMontos.piloto).toBe("25");
  });

  /**
   * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo"
   * ya no se utiliza: aplicarDefaultsRutaSinSobrescribir ya NO acepta ni
   * devuelve costoOperativoReferencia (antes lo sugería/copiaba de la
   * ruta igual que tarifaComercial). Esta prueba es la guarda de
   * regresión: el resultado nunca debe traer esa clave.
   */
  it("el resultado nunca incluye costoOperativoReferencia (campo retirado)", () => {
    const result = aplicarDefaultsRutaSinSobrescribir(vacio, 1250, personal);
    expect(result).not.toHaveProperty("costoOperativoReferencia");
  });
});

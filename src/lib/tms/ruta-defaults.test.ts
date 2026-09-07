import { describe, expect, it } from "vitest";
import { aplicarDefaultsRutaSinSobrescribir } from "./ruta-defaults";

const personal = [
  { empleadoId: 10, empleadoNombre: "Piloto", rol: "Piloto" as const, viaticoMonto: 150 },
  { empleadoId: 20, empleadoNombre: "Aux 1", rol: "Auxiliar" as const, viaticoMonto: 75 },
  { empleadoId: 21, empleadoNombre: "Aux 2", rol: "Auxiliar" as const, viaticoMonto: 80 },
];

const vacio = {
  tarifaComercial: "",
  costoOperativoReferencia: "",
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
      costoOperativoReferencia: "",
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
      costoOperativoReferencia: "500",
      pilotoEmpleadoId: 99,
      pilotoNombre: "Manual",
      auxiliarEmpleadoIds: [98],
      auxiliarNombres: [],
      viaticosMontos: { piloto: "33", "aux-emp-98": "44" },
    };
    expect(aplicarDefaultsRutaSinSobrescribir(actual, 1250, personal, 900)).toEqual(actual);
  });

  it("preserva auxiliares libres y completa solo el piloto vacío", () => {
    const actual = { ...vacio, auxiliarNombres: ["Auxiliar libre"], viaticosMontos: { piloto: "25" } };
    const result = aplicarDefaultsRutaSinSobrescribir(actual, null, personal);
    expect(result.auxiliarNombres).toEqual(["Auxiliar libre"]);
    expect(result.auxiliarEmpleadoIds).toEqual([]);
    expect(result.pilotoEmpleadoId).toBe(10);
    expect(result.viaticosMontos.piloto).toBe("25");
  });

  it("precarga el costo operativo de referencia de la ruta solo si viene vacío (snapshot editable, TMS-GASTOS-REPORTES-1)", () => {
    const result = aplicarDefaultsRutaSinSobrescribir(vacio, 1250, personal, 900);
    expect(result.costoOperativoReferencia).toBe("900");
  });

  it("no pisa un costo operativo ya capturado manualmente aunque la ruta traiga uno distinto", () => {
    const actual = { ...vacio, costoOperativoReferencia: "111" };
    const result = aplicarDefaultsRutaSinSobrescribir(actual, 1250, personal, 900);
    expect(result.costoOperativoReferencia).toBe("111");
  });

  it("sin costo operativo en la ruta, deja el campo vacío tal cual (nunca inventa un valor)", () => {
    const result = aplicarDefaultsRutaSinSobrescribir(vacio, 1250, personal, null);
    expect(result.costoOperativoReferencia).toBe("");
  });
});

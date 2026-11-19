import { describe, expect, it } from "vitest";
import { calcularTransito, estadoTraslado, registrarRecepcion } from "./traslados-reglas";

describe("cantidades de traslados", () => {
  it("conserva lo no recibido en tránsito durante recepciones parciales", () => {
    const parcial = registrarRecepcion({ enviado: 10, recibido: 0, faltante: 0 }, 4, 0);
    expect(calcularTransito(parcial)).toBe(6);
    expect(estadoTraslado([parcial])).toBe("ENVIADO");
    const completo = registrarRecepcion(parcial, 6, 0);
    expect(estadoTraslado([completo])).toBe("RECIBIDO");
  });
  it("registra el faltante sin ingresarlo a destino", () => {
    const resultado = registrarRecepcion({ enviado: 10, recibido: 0, faltante: 0 }, 7, 3);
    expect(resultado.recibido).toBe(7);
    expect(calcularTransito(resultado)).toBe(0);
    expect(estadoTraslado([resultado])).toBe("CON_DIFERENCIAS");
  });
  it("rechaza exceso, negativos, fracciones y cantidades inseguras", () => {
    const saldo = { enviado: 10, recibido: 4, faltante: 1 };
    for (const [cantidad, faltante] of [[6,0],[-1,0],[1.5,0],[0,0],[Number.MAX_SAFE_INTEGER,0]]) {
      expect(() => registrarRecepcion(saldo, cantidad, faltante)).toThrow();
    }
    expect(() => calcularTransito({ enviado: 1, recibido: 1, faltante: 1 })).toThrow();
  });
  it("no cierra el traslado mientras alguna partida permanezca en tránsito", () => {
    expect(estadoTraslado([{ enviado: 3, recibido: 2, faltante: 1 }, { enviado: 2, recibido: 1, faltante: 0 }])).toBe("ENVIADO");
  });
});


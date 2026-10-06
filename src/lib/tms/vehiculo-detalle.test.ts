import { describe, expect, it } from "vitest";
import { detalleVehiculoCatalogo } from "./vehiculo-detalle";

describe("detalleVehiculoCatalogo", () => {
  it("propio: solo marca y modelo (sin cambios respecto a antes)", () => {
    expect(detalleVehiculoCatalogo({ marca: "Hino", modelo: "500" })).toBe("Hino 500");
    expect(detalleVehiculoCatalogo({ marca: null, modelo: null, compartido: false })).toBe("");
  });
  it("compartido: agrega la empresa dueña y «Compartido»", () => {
    expect(detalleVehiculoCatalogo({ marca: "Volvo", modelo: "FH", compartido: true, empresaDuenaNombre: "Frescofresh" }))
      .toBe("Volvo FH · Frescofresh · Compartido");
    expect(detalleVehiculoCatalogo({ compartido: true })).toBe("Compartido");
  });
});

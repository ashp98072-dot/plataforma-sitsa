import { describe, expect, it } from "vitest";
import { descargaDeParadas, descripcionReporteDistinta, mismaDescripcion, resolverDescargaReporte } from "./plan-lugares";

/** PROGRAMACION-PARADAS-FUENTE — regla pura que decide el «Lugar de Descarga» del reporte a partir de las paradas. */
const CARGA = { lugarNombre: "Bodega Calsa", tipo: "Carga" };
const D1 = { lugarNombre: "CD Walmart", tipo: "Descarga" };
const D2 = { lugarNombre: "Super 2", tipo: "Descarga" };
const E1 = { lugarNombre: "Entrega X", tipo: "Entrega" };

describe("descargaDeParadas / mismaDescripcion", () => {
  it("la PRIMERA Descarga o Entrega (nunca concatena, ignora la Carga y vacíos)", () => {
    expect(descargaDeParadas([CARGA, D1, D2])).toBe("CD Walmart");
    expect(descargaDeParadas([CARGA, E1, D1])).toBe("Entrega X");
    expect(descargaDeParadas([CARGA])).toBeUndefined();
    expect(descargaDeParadas([CARGA, { lugarNombre: "  ", tipo: "Descarga" }, D2])).toBe("Super 2");
  });
  it("igualdad tolerante a mayúsculas y espacios", () => {
    expect(mismaDescripcion("  cd   WALMART ", "CD Walmart")).toBe(true);
    expect(mismaDescripcion("CD Walmart", "CD Walmart 2")).toBe(false);
  });
  it("descripción «distinta» solo si es no vacía y difiere de la primera descarga", () => {
    expect(descripcionReporteDistinta("CD Walmart", [CARGA, D1])).toBe(false);
    expect(descripcionReporteDistinta("RUTA-A - p1-p2", [CARGA, D1])).toBe(true);
    expect(descripcionReporteDistinta("", [CARGA, D1])).toBe(false);
    expect(descripcionReporteDistinta("Histórico", [])).toBe(true);
  });
});

describe("resolverDescargaReporte — creación", () => {
  it("sin instrucción explícita: primera Descarga/Entrega de las paradas", () => {
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: [CARGA, D1, D2] })).toEqual({ aplicar: true, valor: "CD Walmart" });
    expect(resolverDescargaReporte({ override: "", paradasNuevas: [CARGA, E1] })).toEqual({ aplicar: true, valor: "Entrega X" });
  });
  it("descripción distinta explícita gana sobre las paradas", () => {
    expect(resolverDescargaReporte({ override: "  RUTA-A - p1-p2 ", paradasNuevas: [CARGA, D1] })).toEqual({ aplicar: true, valor: "RUTA-A - p1-p2" });
  });
  it("sin paradas: respaldo del campo clásico; si tampoco, NULL", () => {
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: [], respaldoLegacy: " Destino clásico " })).toEqual({ aplicar: true, valor: "Destino clásico" });
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: [] })).toEqual({ aplicar: true, valor: null });
  });
});

describe("resolverDescargaReporte — edición", () => {
  const actual = (historico: string | null, paradas = [CARGA, D1]) => ({ historico, paradas });
  it("el destino de las paradas cambia y el snapshot seguía a la parada: se actualiza", () => {
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: [CARGA, { lugarNombre: "B2", tipo: "Descarga" }], actual: actual("CD Walmart") })).toEqual({ aplicar: true, valor: "B2" });
  });
  it("snapshot vacío + paradas nuevas: se completa desde la primera descarga", () => {
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: [CARGA, D1], actual: actual(null, []) })).toEqual({ aplicar: true, valor: "CD Walmart" });
  });
  it("descripción distinta guardada: no se pisa al editar paradas", () => {
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: [CARGA, D2], actual: actual("RUTA-A - p1-p2") })).toEqual({ aplicar: false, valor: null });
  });
  it("viaje histórico con snapshot y sin paradas: se conserva", () => {
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: [CARGA, D1], actual: actual("Destino histórico", []) })).toEqual({ aplicar: false, valor: null });
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: undefined, actual: actual("Destino histórico", []) })).toEqual({ aplicar: false, valor: null });
  });
  it("sin paradas nuevas ni override no se toca la columna", () => {
    expect(resolverDescargaReporte({ override: undefined, paradasNuevas: undefined, actual: actual("CD Walmart") })).toEqual({ aplicar: false, valor: null });
  });
  it("override null: vuelve a seguir a las paradas (nuevas o, si no vienen, las actuales)", () => {
    expect(resolverDescargaReporte({ override: null, paradasNuevas: [CARGA, D2], actual: actual("RUTA-A") })).toEqual({ aplicar: true, valor: "Super 2" });
    expect(resolverDescargaReporte({ override: null, paradasNuevas: undefined, actual: actual("RUTA-A") })).toEqual({ aplicar: true, valor: "CD Walmart" });
    expect(resolverDescargaReporte({ override: null, paradasNuevas: undefined, actual: actual("RUTA-A", []) })).toEqual({ aplicar: true, valor: null });
  });
  it("override con texto: se escribe", () => {
    expect(resolverDescargaReporte({ override: "Otro", paradasNuevas: undefined, actual: actual("CD Walmart") })).toEqual({ aplicar: true, valor: "Otro" });
  });
});

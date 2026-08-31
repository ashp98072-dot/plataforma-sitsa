import { expect, it } from "vitest";
import { libroUnicoActivo } from "./seleccion-libro";
it("selecciona un único libro activo sin inventar ids", () => {
  expect(libroUnicoActivo([{ id: 17, activa: 1 }, { id: 18, activa: 0 }])).toBe("17");
});
it("dos libros KT/Mónaco requieren selección explícita", () => {
  expect(libroUnicoActivo([{ id: 17, activa: 1 }, { id: 18, activa: 1 }])).toBe("");
});
it("sin libro activo no crea ni selecciona otro", () => {
  expect(libroUnicoActivo([])).toBe("");
  expect(libroUnicoActivo([{ id: 17, activa: 0 }])).toBe("");
});

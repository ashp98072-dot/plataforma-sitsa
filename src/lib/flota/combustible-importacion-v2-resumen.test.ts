import { beforeAll, describe, expect, it } from "vitest";
import { analizarProveedorV2, resumirProveedorV2 } from "./combustible-importacion-v2";
import { fixtureHalelV2 } from "./combustible-importacion-v2.fixture";
import type { FilaProveedorV2, PreviewProveedorV2 } from "./combustible-importacion-v2-types";

let base: PreviewProveedorV2;
let fila: FilaProveedorV2;
beforeAll(async () => {
  base = await analizarProveedorV2(await fixtureHalelV2(), "HALEL");
  fila = { ...base.filas.find(f => f.identidadCandidata)!, estado: "VALIDA", galones: "2.5", monto: "100", conflicto: false, posiblePrevio: false, duplicadoDe: null };
});

describe("elegibilidad por identidad candidata, independiente de apariciones y orden", () => {
  it.each([
    { caso: "primera inválida y segunda válida", primera: { estado: "INVALIDA" }, segunda: {} },
    { caso: "primera válida y segunda inválida", primera: {}, segunda: { estado: "INVALIDA" } },
    { caso: "primera válida y segunda posible previo", primera: {}, segunda: { posiblePrevio: true } },
    { caso: "conflicto marcado únicamente en la segunda", primera: {}, segunda: { conflicto: true } },
    { caso: "huellas contradictorias sin propagar flag de conflicto", primera: {}, segunda: { huella: "huella-distinta-sintetica", monto: "200" } },
  ] satisfies { caso: string; primera: Partial<FilaProveedorV2>; segunda: Partial<FilaProveedorV2> }[])("$caso: bloquea todo el candidato en ambos órdenes", ({ primera, segunda }) => {
    const apariciones = [{ ...structuredClone(fila), ...primera }, { ...structuredClone(fila), fila: fila.fila + 1, ...segunda }];
    const independiente = { ...structuredClone(fila), identidadCandidata: "otra-identidad-sintetica", vale: "OTRO-DEMO", galones: "7", monto: "70" };
    const antes = structuredClone(apariciones);
    for (const orden of [apariciones, [...apariciones].reverse()]) {
      const p = { ...base, filas: [...orden, independiente] };
      resumirProveedorV2(p);
      expect(p.resumen).toMatchObject({ apariciones: 3, candidatos: 2, bloqueados: 1, elegibles: 1, galonesElegibles: "7", montoElegible: "70" });
      // Ninguna aparición bloqueada contribuye; otro candidato permanece independiente.
      const soloBloqueado = { ...base, filas: orden };
      resumirProveedorV2(soloBloqueado);
      expect(soloBloqueado.resumen).toMatchObject({ candidatos: 1, bloqueados: 1, elegibles: 0, galonesElegibles: "0", montoElegible: "0" });
    }
    expect(apariciones).toEqual(antes); // resumir no reescribe la evidencia
  });

  it("duplicados exactos válidos suman una sola vez en todas las permutaciones, aun sin referencia canónica", () => {
    const a = structuredClone(fila), b = { ...structuredClone(fila), fila: fila.fila + 1, duplicadoDe: 0 };
    const c = { ...structuredClone(fila), fila: fila.fila + 2, duplicadoDe: null };
    for (const filas of [[a, b, c], [a, c, b], [b, a, c], [b, c, a], [c, a, b], [c, b, a]]) {
      const p = { ...base, filas };
      resumirProveedorV2(p);
      expect(p.resumen).toMatchObject({ apariciones: 3, candidatos: 1, bloqueados: 0, elegibles: 1, galonesElegibles: "2.5", montoElegible: "100" });
    }
  });
});

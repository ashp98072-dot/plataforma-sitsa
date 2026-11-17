import { expect, it } from "vitest";
import { decisionesMasivas } from "./nombres-masivos";
import type { RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";

const n = (nombre: string, candidatos: string[], extra: Partial<RevisionNombre> = {}): RevisionNombre => ({ clave: nombre.toUpperCase(), originales: [nombre], filas: 2, candidatos: candidatos.map((c, i) => ({ id: i + 1, nombre: c })), propuesta: null, ...extra });
const claves = (xs: RevisionNombre[]) => xs.map((x) => x.clave);

it("regla segura: reportado solo SIN candidatos; empleado solo con UN candidato y TODAS las palabras exactas (≥2); lo demás queda manual (ortografía distinta, otra persona con el mismo apellido, una palabra, varios, equivalencia previa, ya decidido)", () => {
  const lista = [
    n("Luis Escobar", []), n("Marvin Xol", ["Marvin Xol Pop"]), n("Álvaro Pinto", ["Alvaro Antonio León Pinto"]),            // acentos: coinciden
    n("Mario Alvizures", ["Maria Andrea Alvizures Polanco De Sitan"]), n("Edgar Tiul", ["Edgar Anibal Tul Paau"]), n("Gammer Garcia", ["Gamner Denilsen García Morales"]),   // aproximados → manual
    n("Raydel", ["Raydel Lopez"]), n("Jose Vasquez", ["Jose Vasquez A", "Jose Vasquez B"]), n("Pedro Coc", [], { equivalencia: { tipo: "REPORTADO", confirmado: false } }),
    n("Ya Decidido", []), n("Con Propuesta Sola", [], { propuesta: { tipo: "REPORTADO", confirmado: false } }),
  ];
  const m = decisionesMasivas(lista, { "YA DECIDIDO": { tipo: "REPORTADO", confirmado: true } });
  expect(claves(m.reportado)).toEqual(["LUIS ESCOBAR"]); expect(claves(m.empleado)).toEqual(["MARVIN XOL", "ÁLVARO PINTO"]);
  expect(m.sinDecidir).toBe(10); expect(m.manuales).toBe(10 - 1 - 2);
  expect(decisionesMasivas([n("Luis Escobar", [])], {}).empleado).toEqual([]);   // sin candidatos jamás se asigna empleado
});

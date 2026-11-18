import { expect, it } from "vitest";
import { resumirRevision } from "./preview-model";
import { clavesListas, resumenPrevio } from "./resumen-previo";
import { motivoUnidadNoOperable, unidadOperable } from "./unidades-bloqueo";
import type { CatalogosCB2, FilaCB2 } from "./client";

const fila = (candidato: string | null, placa: string, extra: Record<string, unknown> = {}) => ({ candidato, perfil: "HALEL", estado: "LISTA", bloqueada: false, placa, placaNormalizada: placa, vale: candidato ?? "x", hoja: "H", fila: 2, motivos: [], errores: [], moneda: "GTQ", origen: { producto: "Diesel", piloto: "" }, ...extra }) as unknown as FilaCB2;
const cat = { proveedores: [], vehiculos: [{ id: 1, placa: "C-111AAA", estado: "Activo" }, { id: 2, placa: "C-222BBB", estado: "En taller" }, { id: 3, placa: "C-333CCC", estado: "Activo" }, { id: 4, placa: "P-333CCC", estado: "Activo" }] } as unknown as CatalogosCB2;

it("una unidad «En taller» no es operable: explica el motivo y la fila queda pendiente (no se descarta ni se asigna)", () => {
  expect(unidadOperable({ placa: "X", estado: "Activo" })).toBe(true); expect(unidadOperable({ placa: "X" })).toBe(true);
  expect(motivoUnidadNoOperable({ placa: "C-222BBB", estado: "En taller" })).toContain("«En taller»");
  const filas = [fila("a", "C-111AAA"), fila("b", "C-222BBB")];
  const r = resumirRevision(filas, cat, { a: "1", b: "2" }, {}, {}, {});
  expect(Object.keys(r.segura)).toEqual(["a"]);   // b: ni siquiera con selección manual forzada
  expect(r.revision.find(g => g.clave === "b")?.estado).toBe("PENDIENTE");
});
it("el resumen previo cuadra por filas: listas + pendientes + bloqueadas + ya importadas + ignoradas = total; los motivos pueden solaparse", () => {
  const filas = [
    fila("a", "C-111AAA"),                                   // lista
    fila("b", "C-222BBB"),                                   // pendiente: En taller
    fila("c", "C-999ZZZ"),                                   // pendiente: sin unidad
    fila("d", "333CCC"),                                     // pendiente: placa ambigua
    fila("e", "C-111AAA", { origen: { producto: "", piloto: "" } }),   // pendiente: sin combustible
    fila("f", "C-111AAA", { perfil: "SHELL" }),              // pendiente: piloto sin decidir
    fila(null, "-"), fila("g", "C-111AAA", { bloqueada: true }),   // bloqueadas
    fila("h", "C-111AAA", { estado: "RESUELTA" }), fila("i", "C-111AAA", { estado: "IGNORADA" }),
  ];
  const asign = { a: "1", b: "2", e: "1", f: "1" } as Record<string, string>, decisiones = { a: { exigirProducto: true }, e: { exigirProducto: true }, f: { exigirProducto: true, pilotoTipo: "REPORTADO" as const } };
  const segura = resumirRevision(filas, cat, asign, {}, {}, decisiones).segura;
  const entrada = { filas, cat, segura, omitidos: {}, decisiones };
  expect([...clavesListas(entrada)]).toEqual(["a"]);
  const r = resumenPrevio(entrada);
  expect(r).toMatchObject({ total: 10, listas: 1, pendientes: 5, validas: 6, bloqueadas: 2, yaImportadas: 1, ignoradas: 1, cuadra: true });
  expect(r.motivos).toMatchObject({ unidadNoOperable: 1, ambiguas: 1, combustible: 1, piloto: 1 });
  expect(r.motivos.unidad).toBeGreaterThanOrEqual(3);   // b (taller), c (sin unidad), d (ambigua)
  expect(r.detalleNoOperables[0]).toContain("C-222BBB");
});
it("las filas excluidas por el usuario siguen pendientes, no listas", () => {
  const filas = [fila("a", "C-111AAA")], decisiones = { a: { exigirProducto: true } };
  const segura = resumirRevision(filas, cat, { a: "1" }, {}, {}, decisiones).segura;
  expect(resumenPrevio({ filas, cat, segura, omitidos: { a: true }, decisiones })).toMatchObject({ listas: 0, pendientes: 1, cuadra: true });
});

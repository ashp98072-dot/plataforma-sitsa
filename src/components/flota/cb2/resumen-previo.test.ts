import { expect, it } from "vitest";
import { resumirRevision } from "./preview-model";
import { clasificarProducto } from "@/lib/flota/cb2/clasificacion";
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
it("las filas con CONSUMO_PREVIO (ya registradas en una importación anterior) se cuentan como ya importadas y no se vuelven a ofrecer; el total sigue cuadrando", () => {
  const previa = { motivos: ["CONSUMO_PREVIO: se revalidará su reutilización, sin crear otro consumo."] };
  const filas = [fila("a", "C-111AAA", previa), fila("b", "C-111AAA"), fila("c", "C-111AAA", { bloqueada: true, motivos: ["CONFLICTO_HISTORICO: vale registrado en otro flujo o con datos distintos."] })];
  const segura = resumirRevision(filas, cat, { a: "1", b: "1" }, {}, {}, { a: { exigirProducto: true }, b: { exigirProducto: true } }).segura;
  const entrada = { filas, cat, segura, omitidos: {}, decisiones: { a: { exigirProducto: true }, b: { exigirProducto: true } } };
  expect([...clavesListas(entrada)]).toEqual(["b"]);
  expect(resumenPrevio(entrada)).toMatchObject({ total: 3, yaImportadas: 1, listas: 1, pendientes: 0, bloqueadas: 1, validas: 1, cuadra: true });   // un conflicto histórico NO es «ya importada»
});

it("«20W50» (aceite) NO se convierte en combustible: queda pendiente hasta que la persona clasifique, y solo entonces (p. ej. NO_DETERMINADO) pasa a lista", () => {
  expect(clasificarProducto("20W50")).toBeNull(); expect(clasificarProducto("Aceite 20W50")).toBeNull(); expect(clasificarProducto("20W-50")).toBeNull();
  const filas = [fila("a", "C-111AAA", { origen: { producto: "20W50", piloto: "" } })], d0 = { a: { exigirProducto: true } };
  const seg = (d: Record<string, { exigirProducto: boolean; productoClasificado?: "NO_DETERMINADO" }>) => resumirRevision(filas, cat, { a: "1" }, {}, {}, d).segura;
  const sin = { filas, cat, segura: seg(d0), omitidos: {}, decisiones: d0 };
  expect(clavesListas(sin).size).toBe(0); expect(resumenPrevio(sin)).toMatchObject({ listas: 0, pendientes: 1, motivos: { combustible: 1 }, cuadra: true });
  const d1 = { a: { exigirProducto: true, productoClasificado: "NO_DETERMINADO" as const } };
  expect(clavesListas({ filas, cat, segura: seg(d1), omitidos: {}, decisiones: d1 }).size).toBe(1);
});
it("el módulo CB2 nunca escribe el estado de las unidades de Flota: una unidad «En taller» solo se reactiva desde Flota", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs"), { join } = await import("node:path");
  const recorrer = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? recorrer(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : []; });
  for (const archivo of [...recorrer("src/lib/flota/cb2"), ...recorrer("src/components/flota/cb2")]) expect(readFileSync(archivo, "utf8"), archivo).not.toMatch(/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+`?flota_vehiculos`?\b/i);
});

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { leerOoxmlProveedor } from "./combustible-ooxml-v2";
import { analizarProveedorV2 } from "./combustible-importacion-v2";
import { fixtureShellV2 } from "./combustible-importacion-v2.fixture";

async function editarXml(edit: (xml: string) => string) {
  const zip = await JSZip.loadAsync(await fixtureShellV2());
  const name = "xl/worksheets/sheet2.xml";
  zip.file(name, edit(await zip.file(name)!.async("string")));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
describe("OOXML v2: exactitud de identificadores y archivos hostiles", () => {
  it("preserva literalmente una serie numérica imposible sin pasar por Number ni inventar precisión", async () => {
    const literal = "7.1230000000000005E+198"; // inventado; no reproduce la serie del archivo privado
    const b = await editarXml(x => x.replace(/<c r="C354"[^>]*>[\s\S]*?<\/c>/, `<c r="C354"><v>${literal}</v></c>`));
    expect(leerOoxmlProveedor(b).get("SEPTIEMBRE")?.get("C354")).toBe(literal);
    const a = await analizarProveedorV2(b, "SHELL");
    const f = a.filas.find(f => f.hoja === "SEPTIEMBRE" && f.fila === 354)!;
    expect(f.serie).toBe(literal);
    expect(f.celdas.find(c => c.direccion === "C354")?.valor).toBe(literal);
    expect(f.estado).toBe("INVALIDA"); expect(a.resumen).toMatchObject({ candidatos: 663, bloqueados: 1, elegibles: 662 });
  });
  it("un identificador textual largo fiable permanece texto y no se bloquea por tamaño entero", async () => {
    const literal = "000123456789012345678901234567890";
    const b = await editarXml(x => x.replace(/<c r="C354"[^>]*>[\s\S]*?<\/c>/, `<c r="C354" t="inlineStr"><is><t>${literal}</t></is></c>`));
    const a = await analizarProveedorV2(b, "SHELL");
    expect(a.filas.find(f => f.hoja === "SEPTIEMBRE" && f.fila === 354)?.serie).toBe(literal);
    expect(a.resumen).toMatchObject({ candidatos: 663, bloqueados: 0, elegibles: 663 });
  });
  it("identificador numérico de más de 53 bits conserva los dígitos del XML, aunque ExcelJS los redondearía", async () => {
    const literal = "9007199254740993";
    const b = await editarXml(x => x.replace(/<c r="D354"[^>]*>[\s\S]*?<\/c>/, `<c r="D354"><v>${literal}</v></c>`));
    const a = await analizarProveedorV2(b, "SHELL");
    expect(a.filas.find(f => f.hoja === "SEPTIEMBRE" && f.fila === 354)).toMatchObject({ factura: literal, estado: "INVALIDA" });
  });
  it("rechaza el tamaño expandido falsificado antes de cargar ExcelJS", async () => {
    const b = Buffer.from(await editarXml(x => x));
    const end = b.length - 22; const directory = b.readUInt32LE(end + 16);
    b.writeUInt32LE(1, directory + 24);
    expect(() => leerOoxmlProveedor(b)).toThrow("OOXML");
  });
  it.each([
    (x: string) => x.replace(/<worksheet/, '<!DOCTYPE worksheet [<!ENTITY malicious "xx">]><worksheet'),
    (x: string) => x.replace('r="A2"', 'r="XFD1048576"'),
    (x: string) => x.replace("</worksheet>", '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells></worksheet>'),
  ])("rechaza DTD, coordenadas y combinaciones masivas antes de cargar ExcelJS", async edit => {
    const b = await editarXml(edit);
    expect(() => leerOoxmlProveedor(b)).toThrow("OOXML");
  });
});

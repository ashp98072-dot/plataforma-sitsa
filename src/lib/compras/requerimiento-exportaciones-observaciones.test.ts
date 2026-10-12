import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requerimientoCompraExcel, requerimientoCompraPdf } from "./requerimiento-exportaciones";
import { compraReporteFixture as base } from "./requerimiento-exportaciones.fixture";
import type { DetalleCompra } from "./requerimiento-schema";

/**
 * Observaciones (generales y por línea) en las exportaciones de Compras: el PDF ya las dibuja; el Excel las volcaba en filas
 * combinadas de altura estimada solo por longitud (ignoraba los saltos de línea y no acotaba textos largos). Estas pruebas
 * fijan el contrato: texto completo, saltos respetados, altura suficiente y nada recortado.
 */
afterEach(() => vi.restoreAllMocks());

const detalle = (sobre: Partial<DetalleCompra>): DetalleCompra => ({ ...base, estado: "Pendiente", ...sobre });
const conLineas = (observaciones: (string | null)[]): DetalleCompra["lineas"] =>
  observaciones.map((o, i) => ({ ...base.lineas[i % base.lineas.length], id: i + 1, observaciones: o }));

async function hoja(d: DetalleCompra) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await requerimientoCompraExcel(d, "Tenant")) as unknown as ExcelJS.Buffer);
  return wb.worksheets[0];
}
/** Filas combinadas (A..I) cuyo texto empieza por `prefijo` o es continuación posterior a ese texto. */
function celdasTexto(ws: ExcelJS.Worksheet) {
  const filas: { fila: number; texto: string; alto: number | undefined }[] = [];
  ws.eachRow((row, n) => {
    const valor = row.getCell(1).value;
    if (typeof valor === "string") filas.push({ fila: n, texto: valor, alto: row.height });
  });
  return filas;
}

describe("Excel — observaciones por línea y generales", () => {
  it("las dos aparecen completas, con su etiqueta, y su fila tiene wrapText", async () => {
    const ws = await hoja(detalle({ lineas: conLineas(["Entrega en taller.", null]), observaciones: "Revisión de vehículo." }));
    const textos = celdasTexto(ws).map(f => f.texto);
    expect(textos).toContain("Observaciones de línea 1: Entrega en taller.");
    expect(textos).toContain("Observaciones del requerimiento: Revisión de vehículo.");
    expect(textos.some(t => t.startsWith("Observaciones de línea 2"))).toBe(false); // sin observación → sin fila inventada
    const fila = celdasTexto(ws).find(f => f.texto.startsWith("Observaciones de línea 1"))!;
    expect(ws.getRow(fila.fila).alignment).toMatchObject({ wrapText: true, vertical: "top" });
  });

  it("saltos de línea: una observación de 12 líneas cortas NO se corta (altura según las líneas reales, no solo la longitud)", async () => {
    const doce = Array.from({ length: 12 }, (_, i) => `punto ${i + 1}`).join("\n");
    const ws = await hoja(detalle({ lineas: conLineas([doce]), observaciones: null }));
    const fila = celdasTexto(ws).find(f => f.texto.startsWith("Observaciones de línea 1"))!;
    expect(fila.texto).toBe(`Observaciones de línea 1: ${doce}`);
    // 13 líneas visuales (la etiqueta comparte la primera): al menos 12 × 14 pt. Con la fórmula anterior (≈ longitud / 140) eran 18 pt.
    expect(fila.alto).toBeGreaterThanOrEqual(12 * 14);
  });

  it("texto muy largo: se reparte en filas siguientes (Excel limita la fila a 409 pt) sin perder ni un carácter", async () => {
    const parrafos = Array.from({ length: 60 }, (_, i) => `Párrafo ${String(i).padStart(2, "0")}: ${"detalle ".repeat(20).trim()}`);
    const largo = parrafos.join("\n");
    const ws = await hoja(detalle({ lineas: conLineas([null]), observaciones: largo }));
    const filas = celdasTexto(ws);
    const inicio = filas.findIndex(f => f.texto.startsWith("Observaciones del requerimiento: "));
    expect(inicio).toBeGreaterThan(-1);
    // Todas las filas de continuación son contiguas hasta el siguiente bloque («PENDIENTE DE AUTORIZACIÓN»).
    const fin = filas.findIndex((f, i) => i > inicio && f.texto === "PENDIENTE DE AUTORIZACIÓN");
    const bloque = filas.slice(inicio, fin);
    expect(bloque.length).toBeGreaterThan(1);
    for (const f of bloque) expect(f.alto ?? 0).toBeLessThanOrEqual(409);
    expect(bloque.map(f => f.texto).join("\n")).toBe(`Observaciones del requerimiento: ${largo}`);
  });

  it("texto de 10 000 caracteres (máximo del campo) en una sola línea lógica se conserva íntegro", async () => {
    const palabra = "abcdefghi ";
    const largo = palabra.repeat(1000).trim();
    const ws = await hoja(detalle({ lineas: conLineas([null]), observaciones: largo }));
    const filas = celdasTexto(ws);
    const inicio = filas.findIndex(f => f.texto.startsWith("Observaciones del requerimiento: "));
    const fin = filas.findIndex((f, i) => i > inicio && f.texto === "PENDIENTE DE AUTORIZACIÓN");
    const unido = filas.slice(inicio, fin).map(f => f.texto).join(" ").replace(/^Observaciones del requerimiento: /, "");
    expect(unido.replace(/\s+/g, " ")).toBe(largo);
    for (const f of filas.slice(inicio, fin)) expect(f.alto ?? 0).toBeLessThanOrEqual(409);
  });

  it("sin observaciones no agrega filas de observaciones ni cambia el TOTAL ni la tabla", async () => {
    const ws = await hoja(detalle({ lineas: conLineas([null, null]), observaciones: null }));
    const textos = celdasTexto(ws).map(f => f.texto);
    expect(textos.some(t => t.startsWith("Observaciones"))).toBe(false);
    let total: unknown;
    ws.eachRow(r => { if (r.getCell(1).value === "TOTAL:") total = r.getCell(9).value; });
    expect(total).toBe(Number(base.total));
  });

  it("textos cortos conservan la altura de siempre (18 pt)", async () => {
    const ws = await hoja(detalle({ lineas: conLineas(["Corta"]), observaciones: null }));
    const fila = celdasTexto(ws).find(f => f.texto.startsWith("Observaciones de línea 1"))!;
    expect(fila.alto).toBe(18);
  });
});

describe("PDF — observaciones por línea y generales", () => {
  async function textosPdf(d: DetalleCompra) {
    const spy = vi.spyOn(PDFDocument.prototype, "text");
    const buf = await requerimientoCompraPdf(d, "Tenant", null);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    return spy.mock.calls.map(c => String(c[0]));
  }

  it("dibuja ambas con su texto íntegro y sus saltos de línea", async () => {
    const t = await textosPdf(detalle({ lineas: conLineas(["Primera\nSegunda", null]), observaciones: "General línea 1\nGeneral línea 2" }));
    expect(t).toContain("Observaciones de línea 1: Primera\nSegunda");
    expect(t).toContain("Observaciones del requerimiento: General línea 1\nGeneral línea 2");
    expect(t.some(x => x.startsWith("Observaciones de línea 2"))).toBe(false);
  });

  it("observaciones largas (10 000 caracteres) no se recortan y las firmas siguen presentes", async () => {
    const largo = "palabra ".repeat(1250).trim();
    const t = await textosPdf(detalle({ lineas: conLineas([null]), observaciones: largo }));
    expect(t).toContain(`Observaciones del requerimiento: ${largo}`);
    for (const f of ["FIRMA DE LA PERSONA QUE REQUIERE", "FIRMA DEL ENCARGADO DE COMPRAS", "FIRMA DEL AUTORIZANTE"]) expect(t).toContain(f);
  });

  it("sin observaciones no dibuja bloques de observaciones", async () => {
    const t = await textosPdf(detalle({ lineas: conLineas([null, null]), observaciones: null }));
    expect(t.some(x => x.startsWith("Observaciones"))).toBe(false);
  });
});

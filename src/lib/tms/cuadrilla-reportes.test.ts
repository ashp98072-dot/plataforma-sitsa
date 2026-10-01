import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { tablaAExcel, wrapText } from "@/lib/rrhh/export-files";
import { formatearCuadrillaExcel } from "./programacion-excel-cuadrilla";
import { textoCuadrillaPdf } from "./programacion-cuadrilla-pdf";
import { construirLayoutImagen, envolverTexto, altoFilaImagen, type FilaProgramacionImagen } from "./programacion-imagen";

const encabezado = { empresa: "Empresa", rango: "2026-10-01", filtros: "", generado: "" };
const base: FilaProgramacionImagen = { mes: "OCT", dia: "1", placa: "P-1", tc: "", piloto: "Piloto", auxiliar1: "Auxiliar", auxiliar2: "", cliente: "Cliente", lugarCarga: "Carga", hora: "08:00", lugarDescarga: "Descarga" };
const nombres = (n: number, largos = false) => Array.from({ length: n }, (_, i) => `${largos ? "W".repeat(190) : `Integrante ${i + 1}`} (${i % 2 ? "externo" : "interno"})`);
const compacto = (texto: string) => texto.replace(/\s/g, "");
const medir = (texto: string) => Array.from(texto).reduce((total, c) => total + (c === "W" ? 13 : 7), 0);

describe("Cuadrilla — Excel real, sin modificar el generador compartido", () => {
  it("sin columna Cuadrilla retorna el buffer sin cambios", async () => {
    const original = await tablaAExcel({ sheetName: "Programacion", headers: ["Piloto"], rows: [["Piloto"]] });
    expect(await formatearCuadrillaExcel(original)).toBe(original);
  });
  it.each([0, 1, 5, 10, 200])("%i integrantes: wrap, altura visible y continuaciones sin pérdida", async (cantidad) => {
    const lista = nombres(cantidad, cantidad === 200);
    const original = await tablaAExcel({ sheetName: "Programacion", headers: ["Piloto", "Auxiliar 1", "Cuadrilla"], rows: [["Piloto", "Auxiliar", lista.join("\n")]] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await formatearCuadrillaExcel(original) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.worksheets[0];
    expect(ws.getRow(1).values).toEqual([undefined, "Piloto", "Auxiliar 1", "Cuadrilla"]);
    expect(ws.getCell("A2").value).toBe("Piloto"); expect(ws.getCell("B2").value).toBe("Auxiliar");
    expect(ws.getColumn(1).width).toBe(10); expect(ws.getColumn(2).width).toBe(12);
    const recuperado: string[] = [];
    for (let i = 2; i <= ws.rowCount; i++) {
      const fila = ws.getRow(i), celda = fila.getCell(3);
      recuperado.push(String(celda.value ?? ""));
      if (cantidad) {
        expect(celda.alignment.wrapText).toBe(true);
        expect(fila.height).toBeGreaterThanOrEqual(String(celda.value).split("\n").length * 16 + 4);
        expect(fila.height).toBeLessThanOrEqual(409.5);
      }
      if (i > 2) expect(fila.getCell(1).value).toBeNull();
    }
    expect(compacto(recuperado.join("\n"))).toBe(compacto(lista.join("\n")));
  });
  it("nombres largos dentro de una celda crecen sin alterar otra fila del viaje siguiente", async () => {
    const lista = ["María de los Ángeles Fernández de la Cruz (interno)", "Juan Carlos Rodríguez Montenegro (externo)"];
    const original = await tablaAExcel({ sheetName: "Programacion", headers: ["Placa", "Cuadrilla"], rows: [["P-1", lista.join("\n")], ["P-2", "Sin cambios (interno)"]] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await formatearCuadrillaExcel(original) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    expect(wb.worksheets[0].getCell("A3").value).toBe("P-2");
    expect(compacto(String(wb.worksheets[0].getCell("B2").value))).toBe(compacto(lista.join("\n")));
  });
});

describe("Cuadrilla — QA lógico de canvas con métricas de ancho", () => {
  it.each([0, 1, 5, 10, 200])("%i integrantes mixtos y nombres largos: ningún lienzo supera el alto, ningún texto excede la celda", (cantidad) => {
    const lista = nombres(cantidad, cantidad >= 10);
    const layout = construirLayoutImagen(encabezado, [{ ...base, cuadrilla: lista.join("\n") }], { medirTexto: medir });
    if (!cantidad) {
      expect(layout).toEqual(construirLayoutImagen(encabezado, [base]));
      return;
    }
    expect(compacto(layout.paginas.flat().map((fila) => fila.at(-1)).join("\n"))).toBe(compacto(lista.join("\n")));
    for (const pagina of layout.paginas) {
      const envueltas = pagina.map((fila) => fila.map((texto, i) => envolverTexto(texto, layout.anchoColumnas[i] - 16, medir)));
      const alto = 90 + 38 + 48 + envueltas.reduce((sum, fila) => sum + altoFilaImagen(fila.map((celda) => celda.length)), 0);
      expect(alto).toBeLessThanOrEqual(6000);
      envueltas.forEach((fila) => fila.forEach((celda, i) => celda.forEach((linea) => expect(medir(linea)).toBeLessThanOrEqual(layout.anchoColumnas[i] - 16))));
    }
  });
  it("una celda extrema se segmenta incluso si por sí sola excedería un lienzo", () => {
    const texto = "Nombre largo ".repeat(3000);
    const layout = construirLayoutImagen(encabezado, [{ ...base, cuadrilla: texto }], { medirTexto: medir });
    expect(layout.totalPaginas).toBeGreaterThan(1);
    expect(compacto(layout.paginas.flat().map((fila) => fila.at(-1)).join(""))).toBe(compacto(texto));
    for (const pagina of layout.paginas) expect(176 + pagina.reduce((s, fila) => s + altoFilaImagen(fila.map((c) => c.split("\n").length)), 0)).toBeLessThanOrEqual(6000);
  });
});

describe("Cuadrilla — nombres completos en PDF con métricas PDFKit reales", () => {
  it.each([...nombres(10), ...nombres(1, true), "María de los Ángeles Fernández de la Cruz (interno)"])("sin recortes: %s", (nombre) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const preparado = textoCuadrillaPdf(nombre);
    const lineas = wrapText(doc, preparado, 82, 7.5);
    expect(compacto(lineas.join(" "))).toBe(compacto(nombre));
    expect(lineas.join(" ")).not.toContain("…"); expect(lineas.length).toBeLessThanOrEqual(40);
    doc.font("Helvetica").fontSize(7.5);
    lineas.forEach((linea) => expect(doc.widthOfString(linea)).toBeLessThanOrEqual(82));
    doc.end();
  });
});

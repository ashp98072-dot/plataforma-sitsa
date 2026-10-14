import { expect, it } from "vitest";

it("los generadores reales siguen disponibles mediante import diferido", async () => {
  const { tablaAExcel, tablaAPdf } = await import("./export-files");
  const headers = ["Código", "Empleado", "Faltas"];
  const rows = [["E1", "Empleado fixture", "3"], ["E2", "Otro fixture", "1"]];
  const excel = await tablaAExcel({ sheetName: "Incidencias", headers, rows });
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(excel) as never);
  const ws = wb.getWorksheet("Incidencias")!;
  expect(ws.rowCount).toBe(3);
  expect(ws.getRow(1).values).toEqual([undefined, ...headers]);
  expect(ws.getRow(2).values).toEqual([undefined, ...rows[0]]);
  expect(ws.getRow(3).values).toEqual([undefined, ...rows[1]]);
  expect(ws.getRow(1).font.bold).toBe(true);
  const pdf = await tablaAPdf({ title: "Resumen de incidencias", subtitle: "Empresa fixture", headers, rows });
  const { PDFDocument } = await import("pdf-lib");
  const documento = await PDFDocument.load(pdf);
  expect(documento.getPageCount()).toBeGreaterThan(0);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
}, 15000);

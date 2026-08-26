import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { generarPlantillaRutas, parsearExcelRutas } from "@/lib/tms/rutas-import-excel";

describe("Excel modelo de rutas", () => {
  it("es compatible con el importador existente", async () => {
    const plantilla = await generarPlantillaRutas();
    const filas = await parsearExcelRutas(plantilla);
    expect(filas).toHaveLength(0);
  });

  it("replica la estructura operativa de CODIGOS DATA", async () => {
    const plantilla = await generarPlantillaRutas();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(plantilla as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("CODIGOS DATA");
    expect(ws).toBeDefined();
    expect([3, 4, 5, 6, 7, 8].map((col) => ws!.getCell(1, col).value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ws!.getColumn("C").width).toBeCloseTo(7.86, 1);
    expect(ws!.getColumn("H").width).toBeCloseTo(57.43, 1);
    expect(ws!.getCell("F1").numFmt).not.toBe("h:mm");
    expect(ws!.getColumn("F").numFmt).toBe("h:mm");
  });

  it("lee filas llenadas debajo del encabezado oficial", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CODIGOS DATA");
    ws.getRow(1).values = [null, null, "Código", "Cliente", "Lugar de carga", "Hora", "Contacto", "Destino"];
    ws.getRow(2).values = [null, null, "1001", "Acme", "Bodega", "08:00", "Ana", "Sucursal"];
    const filas = await parsearExcelRutas(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas[0]).toMatchObject({ codigoExcel: "1001", clienteExcel: "Acme", horaExcel: "08:00" });
  });
});

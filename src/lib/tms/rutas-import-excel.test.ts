import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { generarPlantillaRutas, parsearExcelRutas } from "@/lib/tms/rutas-import-excel";

describe("Excel modelo de rutas", () => {
  it("es compatible con el importador existente", async () => {
    const plantilla = await generarPlantillaRutas();
    const filas = await parsearExcelRutas(plantilla);
    expect(filas).toHaveLength(0);
  });

  it("presenta encabezados claros sin cambiar las columnas operativas C a H", async () => {
    const plantilla = await generarPlantillaRutas();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(plantilla as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("CODIGOS DATA");
    expect(ws).toBeDefined();
    expect([3, 4, 5, 6, 7, 8].map((col) => ws!.getCell(1, col).value)).toEqual([
      "Código de ruta *", "Cliente *", "Lugar de carga", "Hora habitual", "Contacto", "Destino / lugar de descarga",
    ]);
    expect(ws!.getColumn("C").width).toBeGreaterThanOrEqual(20);
    expect(ws!.getColumn("H").width).toBeGreaterThanOrEqual(45);
    expect(ws!.getCell("F1").numFmt).not.toBe("h:mm");
    expect(ws!.getColumn("F").numFmt).toBe("h:mm");
    expect(ws!.getCell("C2").value).toBe("EJEMPLO-NO-IMPORTAR");
    expect(wb.getWorksheet("AYUDA")!.getCell("A1").value).toBe("CÓMO IMPORTAR RUTAS DE FORMA MASIVA");
    expect(wb.getWorksheet("AYUDA")!.getCell("B12").value).toContain("Previsualizar");
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

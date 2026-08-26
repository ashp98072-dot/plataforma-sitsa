import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { generarPlantillaRutas, parsearExcelRutas } from "@/lib/tms/rutas-import-excel";

describe("Excel modelo de rutas", () => {
  it("es compatible con el importador existente", async () => {
    const plantilla = await generarPlantillaRutas();
    const filas = await parsearExcelRutas(plantilla);
    expect(filas).toHaveLength(0);
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

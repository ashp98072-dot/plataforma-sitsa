import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { generarPlantillaClientes, parsearExcelClientes } from "@/lib/clientes/import-excel";

describe("importación Excel de clientes", () => {
  it("genera una plantilla que el mismo importador puede leer", async () => {
    const plantilla = await generarPlantillaClientes();
    const filas = await parsearExcelClientes(plantilla);
    expect(filas).toHaveLength(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(plantilla as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("CLIENTES")!.getCell("E1").value).toBe("rtu");
    expect(wb.getWorksheet("AYUDA")!.getCell("B3").value).toContain("automático");
  });

  it("acepta encabezados equivalentes y conserva identificadores como texto", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("IMPORTAR");
    ws.addRow(["Código interno", "Cliente", "NIT", "Número de RTU", "Correo", "Tipo", "Actualizar"]);
    ws.addRow(["0007", "Acme", "123-4", "RTU-77", "a@b.gt", "Mixto", "SI"]);
    const filas = await parsearExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas[0]).toMatchObject({ codigo: "0007", nombre: "Acme", nit: "123-4", rtu: "RTU-77", email: "a@b.gt", tipo: "mixto", actualizar: true });
  });

  it("acepta código vacío para que el backend lo genere al crear", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CLIENTES");
    ws.addRow(["codigo", "nombre", "rtu"]);
    ws.addRow(["", "Cliente sin código", "RTU-100"]);
    const filas = await parsearExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas[0]).toMatchObject({ codigo: null, nombre: "Cliente sin código", rtu: "RTU-100" });
  });
});

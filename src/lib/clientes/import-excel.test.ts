import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { generarPlantillaClientes, parsearExcelClientes } from "@/lib/clientes/import-excel";

describe("importación Excel de clientes", () => {
  it("genera una plantilla que el mismo importador puede leer", async () => {
    const plantilla = await generarPlantillaClientes();
    const filas = await parsearExcelClientes(plantilla);
    expect(filas).toHaveLength(0);
  });

  it("acepta encabezados equivalentes y conserva identificadores como texto", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("IMPORTAR");
    ws.addRow(["Código interno", "Cliente", "NIT", "Correo", "Tipo", "Actualizar"]);
    ws.addRow(["0007", "Acme", "123-4", "a@b.gt", "Mixto", "SI"]);
    const filas = await parsearExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas[0]).toMatchObject({ codigo: "0007", nombre: "Acme", nit: "123-4", email: "a@b.gt", tipo: "mixto", actualizar: true });
  });
});

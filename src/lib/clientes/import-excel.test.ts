import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  generarPlantillaClientes,
  parsearContactosExcelClientes,
  parsearExcelClientes,
} from "@/lib/clientes/import-excel";

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

  it("lee la columna condicion_credito como texto libre, sin interpretarla como número", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CLIENTES");
    ws.addRow(["nombre", "condicion_credito"]);
    ws.addRow(["Cliente A", "30 días"]);
    ws.addRow(["Cliente B", "Sin Fecha Límite"]);
    ws.addRow(["Cliente C", "100 días / Pronto Pago"]);
    ws.addRow(["Cliente D", ""]);
    const filas = await parsearExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas.map((f) => f.condicionCredito)).toEqual([
      "30 días",
      "Sin Fecha Límite",
      "100 días / Pronto Pago",
      null,
    ]);
  });

  it("acepta encabezados equivalentes para condicion_credito (limite_de_credito)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CLIENTES");
    ws.addRow(["nombre", "Limite de Crédito"]);
    ws.addRow(["Cliente A", "15 días"]);
    const filas = await parsearExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas[0].condicionCredito).toBe("15 días");
  });
});

describe("plantilla y parser de contactos de cliente (hoja opcional CONTACTOS)", () => {
  it("la plantilla oficial trae una hoja CONTACTOS que el mismo parser lee vacía (sin filas de ejemplo)", async () => {
    const plantilla = await generarPlantillaClientes();
    const contactos = await parsearContactosExcelClientes(plantilla);
    expect(contactos).toHaveLength(0);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(plantilla as unknown as ExcelJS.Buffer);
    expect(wb.getWorksheet("CONTACTOS")!.getCell("A1").value).toBe("cliente_codigo");
  });

  it("si el archivo no trae hoja CONTACTOS, devuelve un array vacío (comportamiento previo intacto)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CLIENTES");
    ws.addRow(["nombre"]);
    ws.addRow(["Cliente A"]);
    const contactos = await parsearContactosExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(contactos).toEqual([]);
  });

  it("lee varios contactos por cliente, identificados por código o por nombre", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CONTACTOS");
    ws.addRow(["cliente_codigo", "cliente_nombre", "nombre", "cargo", "telefono", "email", "observaciones"]);
    ws.addRow(["CLI-1", "", "Ana Pérez", "Gerente", "5555-0001", "ana@x.com", ""]);
    ws.addRow(["", "Cliente B", "Luis López", "", "5555-0002", "", "Solo WhatsApp"]);
    const filas = await parsearContactosExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ clienteCodigo: "CLI-1", clienteNombre: null, nombre: "Ana Pérez", cargo: "Gerente" });
    expect(filas[1]).toMatchObject({ clienteCodigo: null, clienteNombre: "Cliente B", nombre: "Luis López", observaciones: "Solo WhatsApp" });
  });

  it("omite la fila de ejemplo y las filas sin nombre de contacto", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CONTACTOS");
    ws.addRow(["cliente_codigo", "cliente_nombre", "nombre"]);
    ws.addRow(["EJEMPLO-NO-IMPORTAR", "Cliente de ejemplo", "Ana Pérez"]);
    ws.addRow(["CLI-1", "", ""]);
    const filas = await parsearContactosExcelClientes(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas).toEqual([]);
  });
});

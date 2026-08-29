import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportarClientesExcel, exportarClientesPdf } from "@/lib/clientes/export";
import type { Cliente } from "@/lib/clientes/tipos";

const cliente: Cliente = {
  id: 7,
  empresaId: 2,
  codigo: "CLI-000007",
  nombre: "Cliente de prueba",
  razonSocial: "Cliente de Prueba, S.A.",
  nit: "1234567-8",
  rtu: "RTU-1234567",
  telefono: "55550000",
  email: "cliente@ejemplo.com",
  direccion: "Ciudad de Guatemala",
  contactoNombre: "Ana Pérez",
  contactoTelefono: "55551111",
  tipo: "transporte",
  estado: "Activo",
  notas: null,
  tmsClienteId: 9,
  creadoAt: null,
  actualizadoAt: null,
};

describe("exportación de clientes", () => {
  it("incluye código, NIT y RTU en Excel", async () => {
    const buffer = await exportarClientesExcel([cliente], "KT / Mónaco");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("CLIENTES")!;
    expect(ws.getCell("A4").value).toBe("Código");
    expect(ws.getCell("E4").value).toBe("Número de RTU");
    expect(ws.getCell("A5").value).toBe("CLI-000007");
    expect(ws.getCell("E5").value).toBe("RTU-1234567");
    expect(ws.getCell("M5").value).toBe("");
  });

  it("genera un PDF válido", async () => {
    const buffer = await exportarClientesPdf([cliente], "KT / Mónaco");
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
    expect(buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)).toHaveLength(1);
  });
});

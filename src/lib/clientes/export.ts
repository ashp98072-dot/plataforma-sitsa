import ExcelJS from "exceljs";
import { tablaAPdf } from "@/lib/rrhh/export-files";
import { CLIENTE_TIPOS, type Cliente } from "@/lib/clientes/tipos";

const etiquetaTipo = new Map(CLIENTE_TIPOS.map((tipo) => [tipo.value, tipo.label]));

const HEADERS = [
  "Código", "Nombre", "Razón social", "NIT", "Número de RTU", "Teléfono",
  "Email", "Dirección", "Contacto", "Tel. contacto", "Tipo", "Estado", "Notas",
];

function filas(clientes: Cliente[]): string[][] {
  return clientes.map((cliente) => [
    cliente.codigo ?? "",
    cliente.nombre,
    cliente.razonSocial ?? "",
    cliente.nit ?? "",
    cliente.rtu ?? "",
    cliente.telefono ?? "",
    cliente.email ?? "",
    cliente.direccion ?? "",
    cliente.contactoNombre ?? "",
    cliente.contactoTelefono ?? "",
    etiquetaTipo.get(cliente.tipo) ?? cliente.tipo,
    cliente.estado,
    cliente.notas ?? "",
  ]);
}

export async function exportarClientesExcel(
  clientes: Cliente[],
  empresaNombre: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  wb.subject = `Catálogo de clientes - ${empresaNombre}`;
  const ws = wb.addWorksheet("CLIENTES", {
    views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
  });
  ws.mergeCells("A1:M1");
  ws.getCell("A1").value = `CATÁLOGO DE CLIENTES - ${empresaNombre}`;
  ws.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
  ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getCell("A1").alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 30;
  ws.mergeCells("A2:M2");
  ws.getCell("A2").value = `${clientes.length} cliente(s) exportado(s)`;
  ws.getCell("A2").alignment = { horizontal: "center" };
  ws.getCell("A2").font = { italic: true, color: { argb: "FF595959" } };
  ws.addRow([]);
  ws.addRow(HEADERS);
  const header = ws.getRow(4);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 28;
  for (const fila of filas(clientes)) ws.addRow(fila);
  ws.autoFilter = { from: "A4", to: `M${Math.max(4, clientes.length + 4)}` };
  ws.columns = [16, 28, 32, 17, 19, 16, 28, 38, 24, 18, 23, 13, 36].map((width) => ({ width }));
  for (const column of [1, 4, 5, 6, 10]) ws.getColumn(column).numFmt = "@";
  ws.eachRow((row, rowNumber) => {
    if (rowNumber > 4) {
      row.alignment = { vertical: "top", wrapText: true };
      if (rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
    }
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportarClientesPdf(
  clientes: Cliente[],
  empresaNombre: string,
): Promise<Buffer> {
  return tablaAPdf({
    title: "Catálogo de clientes",
    subtitle: `${empresaNombre} · ${clientes.length} cliente(s)`,
    headers: ["Código", "Nombre", "Razón social", "NIT", "RTU", "Teléfono", "Tipo", "Estado"],
    rows: clientes.map((cliente) => [
      cliente.codigo ?? "—",
      cliente.nombre,
      cliente.razonSocial ?? "—",
      cliente.nit ?? "—",
      cliente.rtu ?? "—",
      cliente.telefono ?? "—",
      etiquetaTipo.get(cliente.tipo) ?? cliente.tipo,
      cliente.estado,
    ]),
    layout: "landscape",
    modo: "tabla",
  });
}

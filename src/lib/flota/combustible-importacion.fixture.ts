/** Fixture sintético basado en la estructura HALEL; sin datos privados del archivo real. */
import ExcelJS from "exceljs";
export async function fixtureProveedor(cambiar?: (wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  const headers = ["FechaFactura", "Placas ", "No. Vale", "Galones", "Precio ", "Costo Total", "kilometraje", "PILOTO", "SERIE ", "NRO. DE FACTURA "];
  const datos = Array.from({ length: 10 }, (_, i) => [46304 + i % 5, ` C-${String(i + 1).padStart(3, "0")}ABC `, `00${157301 + i}`, 10 + i, 25.5, (10 + i) * 25.5, i < 4 ? "NO MARCA KM" : i === 4 ? 9748.8 : 10000 + i, i === 5 ? "NO TIENE NOMBRE" : `PERSONA DEMO ${i}`, "SERIE-DEMO", `000${i + 1}`]);
  for (const [nombre, values] of [["Hoja1", datos], ["LOTE DEMO", datos.slice(0, 5)], ["Hoja4", datos.slice(5)]] as const) {
    const ws = wb.addWorksheet(nombre);
    if (nombre !== "Hoja4") ws.addRow([]);
    ws.addRow(headers.map(h => nombre === "Hoja1" ? h : h === "FechaFactura" ? "FECHA" : h === "NRO. DE FACTURA " ? "NO. FACTURA " : h));
    for (const row of values) ws.addRow(row);
    ws.addRow(["TOTAL", null, null, null, null, 1234]); ws.addRow([]); ws.addRow([null, null, null, null, null, 200]);
  }
  cambiar?.(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

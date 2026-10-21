import ExcelJS from "exceljs";

/** Solo datos inventados. Nunca lee archivos del usuario. */
export async function fixtureHalelV2(edit?: (w: ExcelJS.Workbook) => void) {
  const w = new ExcelJS.Workbook();
  const headers = ["FechaFactura", "Placas", "No. Vale", "Galones", "Precio", "Costo Total", "kilometraje", "PILOTO", "SERIE", "NRO. DE FACTURA", "NO. LOTE"];
  const registro = (i: number) => [new Date(Date.UTC(2026, 9, 1 + i % 16)), `C-${String(i + 1).padStart(3, "0")}ZZZ`, String(700000 + i), 4.8090000000000002, 41.59, 200,
    i % 2 ? "NO MARCA KM" : null, i === 4 ? "NO TIENE NOMBRE" : "PILOTO DEMO", "SERIE-DEMO", `00${i + 1}`, i % 3 ? "LOTE-DEMO" : null];
  const base = w.addWorksheet("Consolidado"); base.addRow(["Reporte sintético"]); base.addRow(headers);
  for (let i = 0; i < 21; i++) base.addRow(registro(i));
  base.getCell(13, 5).value = 200;
  for (const [idx, start, count] of [[0, 0, 5], [1, 5, 6], [2, 11, 7]]) {
    const s = w.addWorksheet(`Lote demo ${idx}`); if (idx !== 2) s.addRow(["Título"]);
    s.addRow(headers.map(h => h === "FechaFactura" ? "FECHA" : h === "NRO. DE FACTURA" ? "NO. FACTURA" : h));
    for (let i = start; i < start + count; i++) s.addRow(registro(i));
    s.addRow([null, null, null, null, null, { formula: "SUM(F3:F7)", result: 1000 }]);
    s.addRow([null, null, null, null, null, null, null, "Nota administrativa"]);
    s.addRow([new Date("2026-10-01T00:00:00Z"), 1000]); // fecha + importe auxiliar en columna placa; sin vale ni consumo
  }
  edit?.(w);
  return Buffer.from(await w.xlsx.writeBuffer());
}

export async function fixtureShellV2(edit?: (w: ExcelJS.Workbook) => void) {
  const w = new ExcelJS.Workbook(); let id = 0;
  for (const [name, count, month] of [["25-31 AGOSTO", 98, 7], ["SEPTIEMBRE", 355, 8], ["OCUTUBRE", 210, 9]] as const) {
    const s = w.addWorksheet(name);
    s.addRow(["FECHA", "VALE", "No. Serie", "No. factura", "MONTO", "GLS", "PRODUCTO", "PRECIO", "PILOTO", "PLACAS", month === 7 ? "SALDO" : "OBS"]);
    for (let i = 0; i < count; i++, id++) {
      s.addRow([new Date(Date.UTC(2026, month, 1 + i % 28)), `00${800000 + id}`, "SERIE-SINTETICA", `00${900000 + id}`, 100, null, "Diesel", 40, "PILOTO DEMO", `C-${String(id % 900 + 100)}ZZZ`, null]);
    }
    s.fillFormula(`F2:F${count + 1}`, "E2/H2", Array.from({ length: count }, () => 2.5));
    s.getColumn(6).numFmt = "0.000";
    if (month === 8) {
      for (let r = 42; r <= 56; r++) s.getCell(r, 1).value = new Date("2026-08-03T00:00:00Z");
      s.getCell(74, 1).value = new Date("2026-08-06T00:00:00Z");
      s.getCell(333, 3).value = null; s.getCell(333, 4).value = null;
      s.getCell(308, 5).value = { formula: "60+40", result: 100 };
    }
    if (month === 9) {
      s.getCell(82, 5).value = { formula: "75+25", result: 100 };
      s.getCell(156, 9).value = null;
      s.getCell(331, 11).value = "Nota sintética"; s.getCell(354, 6).numFmt = "0.000";
    }
  }
  edit?.(w);
  return Buffer.from(await w.xlsx.writeBuffer());
}

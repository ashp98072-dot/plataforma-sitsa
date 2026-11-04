import ExcelJS from "exceljs";
import {
  COLUMNAS_EXPORTACION_ANT,
  ETIQUETA_TRAMO,
  NOTA_EXPORTACION_ANTIGUEDAD,
  ROTULO_ANTIGUEDAD,
  filaExportacionAnt,
  valorCeldaImporte,
  type FilaAntiguedad,
  type TotalAntiguedad,
  type TotalMoneda,
} from "./antiguedad-cxc-shared";

/**
 * Columnas (base 0): días = número entero; importes (original, cobrado, saldo) = NÚMERO solo si es exacto en Excel (≤ 15 dígitos
 * significativos, lo que cubre todo DECIMAL(14,2)); si no, TEXTO con la cadena exacta del servidor (nunca se redondea en silencio).
 */
const COL_DIAS = 3;
const COL_IMPORTES = new Set([5, 6, 7]);
const FORMATO_IMPORTE = "#,##0.00";

export async function antiguedadAExcel(
  filas: FilaAntiguedad[],
  totalesPorTramo: TotalAntiguedad[],
  totalesPorMoneda: TotalMoneda[],
  fechaCorte: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Antigüedad");
  ws.addRow([ROTULO_ANTIGUEDAD]);
  ws.addRow([NOTA_EXPORTACION_ANTIGUEDAD]);
  ws.addRow([`Fecha de corte: ${fechaCorte}`]);
  ws.addRow([...COLUMNAS_EXPORTACION_ANT]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(4).font = { bold: true };
  const matriz = filas.map(filaExportacionAnt);
  for (const cel of matriz) {
    const row = ws.addRow(cel.map((v, i) => (i === COL_DIAS ? Number(v) : COL_IMPORTES.has(i) ? valorCeldaImporte(v) : v)));
    for (const i of COL_IMPORTES) if (typeof row.getCell(i + 1).value === "number") row.getCell(i + 1).numFmt = FORMATO_IMPORTE;
  }
  ws.columns = COLUMNAS_EXPORTACION_ANT.map((h, i) => ({ width: Math.min(48, Math.max(12, h.length + 2, ...matriz.map((r) => String(r[i] ?? "").length + 2))) }));

  const wt = wb.addWorksheet("Totales");
  wt.addRow(["Moneda", "Tramo", "Facturas", "Saldo pendiente"]);
  wt.getRow(1).font = { bold: true };
  const conFormato = (fila: ExcelJS.Row) => { if (typeof fila.getCell(4).value === "number") fila.getCell(4).numFmt = FORMATO_IMPORTE; };
  for (const t of totalesPorTramo) conFormato(wt.addRow([t.moneda, ETIQUETA_TRAMO[t.tramo], t.facturas, valorCeldaImporte(t.saldo)]));
  wt.addRow([]);
  for (const t of totalesPorMoneda) conFormato(wt.addRow([t.moneda, "Total de la moneda", t.facturas, valorCeldaImporte(t.saldo)]));
  wt.columns = [{ width: 10 }, { width: 22 }, { width: 12 }, { width: 18 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

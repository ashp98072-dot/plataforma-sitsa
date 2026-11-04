import ExcelJS from "exceljs";
import {
  COLUMNAS_EXPORTACION_CXP,
  ETIQUETA_SITUACION,
  ETIQUETA_TRAMO,
  NOTA_EXPORTACION_CXP,
  ROTULO_ANTIGUEDAD_CXP,
  filaExportacionCxp,
  valorCeldaImporte,
  type FilaAntiguedadCxp,
  type TotalSituacionCxp,
  type TotalTramoCxp,
} from "./antiguedad-shared";

/**
 * Columnas (base 0): 3 = días desde el documento, 6 = días vencidos (número; vacío si no hay vencimiento); 8–12 = importes. Los importes van como
 * NÚMERO solo si son exactos en Excel (≤ 15 dígitos significativos: cubre todo DECIMAL(14,2)); si no, TEXTO con la cadena exacta (nunca se redondea).
 */
const COL_DIAS = new Set([3, 6]);
const COL_IMPORTES = new Set([8, 9, 10, 11, 12]);
const FORMATO_IMPORTE = "#,##0.00";

export async function antiguedadCxpAExcel(
  filas: FilaAntiguedadCxp[], totalesPorTramo: TotalTramoCxp[], totalesPorSituacion: TotalSituacionCxp[], saldoTotal: string, fechaCorte: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Antigüedad CxP");
  ws.addRow([ROTULO_ANTIGUEDAD_CXP]);
  ws.addRow([NOTA_EXPORTACION_CXP]);
  ws.addRow([`Fecha de corte: ${fechaCorte}`]);
  ws.addRow([...COLUMNAS_EXPORTACION_CXP]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(4).font = { bold: true };
  const matriz = filas.map((f) => filaExportacionCxp(f, (t) => ETIQUETA_TRAMO[t]));
  for (const cel of matriz) {
    const row = ws.addRow(cel.map((v, i) => (COL_DIAS.has(i) ? (v === "" ? "" : Number(v)) : COL_IMPORTES.has(i) ? valorCeldaImporte(v) : v)));
    for (const i of COL_IMPORTES) if (typeof row.getCell(i + 1).value === "number") row.getCell(i + 1).numFmt = FORMATO_IMPORTE;
  }
  ws.columns = COLUMNAS_EXPORTACION_CXP.map((h, i) => ({ width: Math.min(48, Math.max(12, h.length + 2, ...matriz.map((r) => String(r[i] ?? "").length + 2))) }));

  const wt = wb.addWorksheet("Totales");
  const conFormato = (fila: ExcelJS.Row) => { if (typeof fila.getCell(3).value === "number") fila.getCell(3).numFmt = FORMATO_IMPORTE; };
  wt.addRow(["Por tramo (desde el documento)", "Facturas", "Saldo pendiente (GTQ)"]);
  wt.getRow(1).font = { bold: true };
  for (const t of totalesPorTramo) conFormato(wt.addRow([ETIQUETA_TRAMO[t.tramo], t.facturas, valorCeldaImporte(t.saldo)]));
  wt.addRow([]);
  wt.addRow(["Por situación de vencimiento", "Facturas", "Saldo pendiente (GTQ)"]).font = { bold: true };
  for (const t of totalesPorSituacion) conFormato(wt.addRow([ETIQUETA_SITUACION[t.situacion], t.facturas, valorCeldaImporte(t.saldo)]));
  wt.addRow([]);
  conFormato(wt.addRow(["Total", filas.length, valorCeldaImporte(saldoTotal)]));
  wt.columns = [{ width: 34 }, { width: 12 }, { width: 24 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

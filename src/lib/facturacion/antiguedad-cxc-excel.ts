import ExcelJS from "exceljs";
import {
  COLUMNAS_EXPORTACION_ANT,
  ETIQUETA_TRAMO,
  NOTA_EXPORTACION_ANTIGUEDAD,
  ROTULO_ANTIGUEDAD,
  filaExportacionAnt,
  type FilaAntiguedad,
  type TotalAntiguedad,
  type TotalMoneda,
} from "./antiguedad-cxc-shared";

/** Índices (base 0) de columnas numéricas: días, monto original, cobrado, saldo. Los importes van como NÚMERO para poder sumarlos. */
const NUMERICAS = new Set([3, 5, 6, 7]);

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
  for (const cel of matriz) ws.addRow(cel.map((v, i) => (NUMERICAS.has(i) && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)));
  ws.columns = COLUMNAS_EXPORTACION_ANT.map((h, i) => ({ width: Math.min(48, Math.max(12, h.length + 2, ...matriz.map((r) => String(r[i] ?? "").length + 2))) }));

  const wt = wb.addWorksheet("Totales");
  wt.addRow(["Moneda", "Tramo", "Facturas", "Saldo pendiente"]);
  wt.getRow(1).font = { bold: true };
  for (const t of totalesPorTramo) wt.addRow([t.moneda, ETIQUETA_TRAMO[t.tramo], t.facturas, Number(t.saldo)]);
  wt.addRow([]);
  for (const t of totalesPorMoneda) wt.addRow([t.moneda, "Total de la moneda", t.facturas, Number(t.saldo)]);
  wt.columns = [{ width: 10 }, { width: 22 }, { width: 12 }, { width: 18 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

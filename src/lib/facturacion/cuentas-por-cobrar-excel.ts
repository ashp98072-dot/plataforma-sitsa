import ExcelJS from "exceljs";
import { COLUMNAS_EXPORTACION, NOTA_EXPORTACION, ROTULO_SALDO_INFORMATIVO, filaExportacion, type FilaCxc } from "./cuentas-por-cobrar-shared";

/**
 * M-2a — Excel de Cuentas por cobrar informativa. Fila 1 = rótulo obligatorio, fila 2 = nota; fila 4 = encabezados; luego
 * EXACTAMENTE las facturas del filtro. Los importes van como NÚMERO (no texto) para que el usuario pueda sumarlos.
 */
const COLUMNAS_NUMERICAS = new Set([4, 5, 6, 10]); // Monto original, Total pagado, Saldo informativo, Neto esperado (índice 0)

export async function cuentasPorCobrarAExcel(filas: FilaCxc[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Cuentas por cobrar");
  ws.addRow([ROTULO_SALDO_INFORMATIVO]);
  ws.addRow([NOTA_EXPORTACION]);
  ws.addRow([]);
  ws.addRow([...COLUMNAS_EXPORTACION]);
  ws.getRow(1).font = { bold: true };
  ws.getRow(4).font = { bold: true };
  const matriz = filas.map(filaExportacion);
  for (const cel of matriz) {
    ws.addRow(cel.map((v, i) => (COLUMNAS_NUMERICAS.has(i) && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)));
  }
  ws.columns = COLUMNAS_EXPORTACION.map((h, i) => ({
    width: Math.min(48, Math.max(12, h.length + 2, ...matriz.map((r) => String(r[i] ?? "").length + 2))),
  }));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

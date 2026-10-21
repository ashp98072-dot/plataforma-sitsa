import ExcelJS from "exceljs";
import { listarViaticosAutorizadosPorPeriodo } from "@/lib/tms/viaticos";
import type { PeriodoComprobante } from "@/lib/tms/viaticos-comprobante-periodo";
import { filasComprobante, totalGeneralComprobante } from "@/lib/tms/viaticos-comprobante-filas";

/**
 * VIATICOS-COMPROBANTE-ADMIN-1 — exportación Excel del MISMO lote histórico que
 * viaticos-comprobante-pdf.ts (mismo criterio `autorizado_en` dentro del período, mismo DTO de filas vía
 * filasComprobante() — un solo mapeo para PDF y Excel, nunca dos consultas/mapeos independientes). Mismas
 * columnas que el PDF (sin "Código de petición"/"Persona que requiere"/"Fecha de solicitud"/"No. Cuenta"/
 * "Banco" — ver docblock de viaticos-comprobante-pdf.ts para el porqué). El PDF es el documento formal; este
 * Excel es el archivo de trabajo/exportación, sin firmas incrustadas.
 *
 * `null` cuando no hay ningún viático autorizado EN EL PERÍODO — mismo contrato que
 * comprobanteAutorizacionesPdf(), el caller (route.ts) decide el mensaje/estado HTTP.
 */
export async function comprobanteAutorizacionesExcel(
  empresaId: number,
  empresaNombre: string,
  periodo: PeriodoComprobante,
): Promise<Buffer | null> {
  const items = await listarViaticosAutorizadosPorPeriodo(empresaId, periodo.inicio, periodo.finExclusivo);
  if (!items.length) return null;

  const filas = filasComprobante(items);
  const total = totalGeneralComprobante(filas);

  const HEADERS = ["Viaje", "Fecha viaje", "Nombre", "Cargo", "Placa", "Cliente", "Cantidad", "Lugar de descarga", "Total"];
  const NCOL = HEADERS.length;
  const FORMATO_GTQ = '"Q "#,##0.00';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Requerimiento de viáticos");
  ws.columns = [12, 12, 26, 16, 10, 20, 9, 32, 12].map((width) => ({ width }));

  const titulo = ws.addRow(["REQUERIMIENTO DE VIÁTICOS"]);
  ws.mergeCells(titulo.number, 1, titulo.number, NCOL);
  titulo.font = { bold: true, size: 14 };
  titulo.alignment = { horizontal: "center" };

  const meta: [string, string][] = [
    ["Empresa requiriente", empresaNombre],
    ["Período", periodo.etiqueta],
    ["Cantidad de viáticos", `${items.length} viático${items.length === 1 ? "" : "s"} autorizado${items.length === 1 ? "" : "s"}`],
  ];
  for (const [rot, val] of meta) {
    const r = ws.addRow([rot, null, null, val]);
    ws.mergeCells(r.number, 1, r.number, 3);
    ws.mergeCells(r.number, 4, r.number, NCOL);
    r.getCell(1).font = { bold: true };
  }
  ws.addRow([]);

  const h = ws.addRow(HEADERS);
  h.font = { bold: true, color: { argb: "FFFFFFFF" } };
  h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  h.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  const colCantidad = HEADERS.indexOf("Cantidad") + 1;
  const colTotal = HEADERS.indexOf("Total") + 1;
  for (const f of filas) {
    const r = ws.addRow([f.viaje, f.fechaViaje, f.nombre, f.cargo, f.placa, f.cliente, f.cantidad, f.lugarDescarga, f.total]);
    r.getCell(colCantidad).alignment = { horizontal: "center" };
  }
  ws.getColumn(colTotal).numFmt = FORMATO_GTQ;

  const filaTotal = ws.addRow([]);
  filaTotal.getCell(colCantidad).value = "TOTAL GENERAL";
  filaTotal.getCell(colCantidad).font = { bold: true };
  filaTotal.getCell(colCantidad).alignment = { horizontal: "right" };
  ws.mergeCells(filaTotal.number, colCantidad, filaTotal.number, colTotal - 1);
  filaTotal.getCell(colTotal).value = total;
  filaTotal.getCell(colTotal).font = { bold: true };
  filaTotal.getCell(colTotal).numFmt = FORMATO_GTQ;

  ws.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number, column: NCOL } };
  ws.views = [{ state: "frozen", ySplit: h.number }];

  for (let r = h.number; r <= filaTotal.number; r++) {
    for (let c = 1; c <= NCOL; c++) {
      ws.getCell(r, c).border = {
        top: { style: "thin", color: { argb: "FF94A3B8" } },
        bottom: { style: "thin", color: { argb: "FF94A3B8" } },
        left: { style: "thin", color: { argb: "FF94A3B8" } },
        right: { style: "thin", color: { argb: "FF94A3B8" } },
      };
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

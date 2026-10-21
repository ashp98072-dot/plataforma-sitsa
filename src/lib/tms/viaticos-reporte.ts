import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { listarViaticosControl, type ViaticoControlItem } from "./viaticos";
import { agruparViaticos } from "./viaticos-agrupacion";
import { coincideFiltroReporte, descripcionFiltros, ESTADOS_REPORTE, tituloReporte, type FiltrosReporteViaticos } from "./viaticos-reporte-filtros";
import { ahoraLocal, formatearFechaVisible } from "@/lib/rrhh/dates";
import { celdaPdf, dibujarTablaEnDoc } from "@/lib/rrhh/export-files";

export async function datosReporteViaticos(empresaId: number, f: FiltrosReporteViaticos, incluirBancario: boolean) {
  const { items } = await listarViaticosControl(empresaId, {
    estado: f.estado === "TODOS" ? undefined : f.estado,
    fechaDesde: f.fechaDesde, fechaHasta: f.fechaHasta, empleadoNombre: f.empleado,
  }, { incluirBancario });
  // Defensa adicional: no depende de que un caller respete el estado de la consulta.
  return items.filter((v) => (f.estado === "TODOS" || v.estado === f.estado)
    && (f.estado !== "PROGRAMADO" || v.montoAsignado > 0) && coincideFiltroReporte(v, f));
}

const HEADERS = ["Viaje", "Fecha", "Cliente", "Empleado", "Rol", "Monto sugerido", "Monto asignado", "Estado", "Método de pago", "Banco", "Cuenta"];
const AUDITORIA = ["Fecha de autorización", "Autorizado por", "Fecha de entrega", "Entregado por", "Fecha de liquidación", "Liquidado por", "Observaciones"];
const moneda = (n: number) => `Q${n.toFixed(2)}`;
export const totalReporte = (items: ViaticoControlItem[]) => items.reduce((s, v) => s + Math.round(v.montoAsignado * 100), 0) / 100;
const valores = (v: ViaticoControlItem, bancario: boolean) => [
  v.planCodigo, formatearFechaVisible(v.fechaPlan), v.cliente ?? "", v.personalNombre, v.rol,
  v.montoSugerido, v.montoAsignado, ESTADOS_REPORTE[v.estado as keyof typeof ESTADOS_REPORTE] ?? v.estado,
  v.metodoPago ?? "", bancario ? v.banco ?? "" : "Restringido", bancario ? v.cuentaBancaria ?? "" : "Restringido",
];
const auditoria = (v: ViaticoControlItem) => [
  celdaPdf(v.autorizadoEn), v.autorizadoPor ?? "", celdaPdf(v.entregadoEn), v.entregadoPor ?? "",
  celdaPdf(v.liquidadoEn), v.liquidadoPor ?? "",
  [v.motivoCambio, v.motivoRechazo, v.observacionesEntrega, v.observacionesLiquidacion].filter(Boolean).join(" | "),
];

/** Una selección/agrupación para ambos formatos; nunca vuelve a consultar por autorización histórica. */
export async function reporteViaticosExcel(items: ViaticoControlItem[], empresa: string, f: FiltrosReporteViaticos, bancario: boolean): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Viáticos ${ESTADOS_REPORTE[f.estado]}`.slice(0, 31));
  const headers = [...HEADERS, ...AUDITORIA];
  ws.columns = ["Grupo", ...headers].map((_, i) => ({ width: i === headers.length ? 40 : i === 4 ? 28 : 18 }));
  for (const text of [empresa, `Viáticos ${ESTADOS_REPORTE[f.estado]}`, descripcionFiltros(f), `Generado: ${ahoraLocal()} · Registros: ${items.length}`]) {
    const r = ws.addRow([text]);
    ws.mergeCells(r.number, 1, r.number, headers.length + 1);
    r.alignment = { wrapText: true, horizontal: "center", vertical: "middle" };
    r.font = { bold: r.number <= 2, size: r.number <= 2 ? 14 : 10 };
    r.height = r.number === 3 ? 40 : 24;
  }
  const h = ws.addRow(["Grupo", ...headers]);
  h.font = { bold: true };
  h.alignment = { wrapText: true, vertical: "middle" };
  h.height = 32;
  for (const g of agruparViaticos(items, f.agrupacion)) {
    for (const v of g.items) {
      const r = ws.addRow([g.etiqueta, ...valores(v, bancario), ...auditoria(v)]);
      r.alignment = { wrapText: true, vertical: "top" };
      r.height = Math.max(30, Math.ceil(String(r.getCell(headers.length + 1).value ?? "").length / 40) * 15);
      r.getCell(7).numFmt = '"Q "#,##0.00';
      r.getCell(8).numFmt = '"Q "#,##0.00';
    }
  }
  const total = ws.addRow([]);
  total.getCell(7).value = "TOTAL GENERAL";
  total.getCell(8).value = totalReporte(items);
  total.getCell(8).numFmt = '"Q "#,##0.00';
  total.font = { bold: true };
  ws.autoFilter = { from: { row: h.number, column: 1 }, to: { row: h.number + items.length, column: headers.length + 1 } };
  ws.views = [{ state: "frozen", ySplit: h.number }];
  ws.getColumn(headers.length + 1).width = 40;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function reporteViaticosPdf(items: ViaticoControlItem[], empresa: string, f: FiltrosReporteViaticos, bancario: boolean): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A3", layout: "landscape", margin: 36, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.font("Helvetica-Bold").fontSize(16).text(tituloReporte(f.estado), { align: "center" });
    doc.fontSize(12).text(empresa, { align: "center" });
    doc.font("Helvetica").fontSize(10).text(descripcionFiltros(f));
    doc.text(`Generado: ${ahoraLocal()} · Registros: ${items.length} · Total: ${moneda(totalReporte(items))}`);
    for (const g of agruparViaticos(items, f.agrupacion)) {
      if (doc.y > doc.page.height - 150) doc.addPage();
      doc.moveDown().font("Helvetica-Bold").fontSize(12).text(`${g.etiqueta} · ${g.items.length} registros · ${moneda(totalReporte(g.items))}`);
      dibujarTablaEnDoc(doc, { headers: HEADERS, rows: g.items.map((v) => valores(v, bancario).map((x) => typeof x === "number" ? moneda(x) : x)), maxLines: 6 });
      // Auditoría separada para conservar legibilidad de las once columnas principales.
      if (g.items.some((v) => auditoria(v).some(Boolean))) {
        if (doc.y > doc.page.height - 150) doc.addPage();
        doc.moveDown().font("Helvetica-Bold").fontSize(11).text("Trazabilidad y observaciones");
        dibujarTablaEnDoc(doc, { headers: ["Viaje", "Empleado", ...AUDITORIA], rows: g.items.map((v) => [v.planCodigo, v.personalNombre, ...auditoria(v)]), maxLines: 8 });
      }
    }
    if (doc.y > doc.page.height - 75) doc.addPage();
    doc.moveDown().font("Helvetica-Bold").fontSize(12).text(`TOTAL GENERAL: ${moneda(totalReporte(items))}`, { align: "right" });
    doc.end();
  });
}

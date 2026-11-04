import ExcelJS from "exceljs";
import { ETIQUETA_SITUACION, valorCeldaImporte } from "./antiguedad-shared";
import {
  COLUMNAS_FACTURAS_ESTADO,
  COLUMNAS_PAGOS_ESTADO,
  NOTA_EXPORTACION_ESTADO_CUENTA,
  NOTA_MONEDA_ESTADO_CUENTA,
  NOTA_SIN_PERMISO_PAGOS,
  ROTULO_ESTADO_CUENTA,
  textoEstadoDocumento,
  type RespuestaEstadoCuenta,
} from "./estado-cuenta-shared";

/**
 * Excel PROPIO de Novalvion (no pretende ser equivalente visual al de Milenium). Importes: NÚMERO solo si es exacto en Excel (≤ 15 dígitos
 * significativos: cubre todo DECIMAL(14,2)); si no, TEXTO con la cadena exacta. Sin permiso de Pagos NO existe la hoja «Pagos» ni se escribe
 * ningún dato de pagos (el servidor ni siquiera los consulta).
 */
const FORMATO = "#,##0.00";
const celda = (v: string) => valorCeldaImporte(v);
const conFormato = (fila: ExcelJS.Row, cols: number[]) => { for (const c of cols) if (typeof fila.getCell(c).value === "number") fila.getCell(c).numFmt = FORMATO; };

export async function estadoCuentaAExcel(d: RespuestaEstadoCuenta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Estado de cuenta");
  ws.addRow([ROTULO_ESTADO_CUENTA]);
  ws.addRow([NOTA_EXPORTACION_ESTADO_CUENTA]);
  ws.addRow([NOTA_MONEDA_ESTADO_CUENTA]);
  const p = d.proveedor;
  const partes = [`Proveedor: ${p.nombre}`, p.nit ? `NIT: ${p.nit}` : null, p.diasCredito != null ? `Días de crédito: ${p.diasCredito}` : null,
    p.regimenFiscal ? `Régimen: ${p.regimenFiscal === "GENERAL" ? "General" : "Pequeño contribuyente"}` : null].filter(Boolean);
  ws.addRow([partes.join(" · ")]);
  ws.addRow([`Fecha de corte: ${d.fechaCorte}`]);
  ws.addRow([`Filtros: ${d.filtros.incluirPagadas ? "incluye pagadas" : "solo abiertas"} · ${d.filtros.incluirAnuladas ? "incluye anuladas" : "sin anuladas"}` +
    `${d.filtros.desde ? ` · documento desde ${d.filtros.desde}` : ""}${d.filtros.hasta ? ` · documento hasta ${d.filtros.hasta}` : ""}`]);
  ws.addRow([]);
  const enc = ws.addRow([...COLUMNAS_FACTURAS_ESTADO]);
  enc.font = { bold: true };
  ws.getRow(1).font = { bold: true };
  for (const f of d.filas) {
    const r = ws.addRow([
      f.documento, f.fechaDocumento, f.fechaVencimiento ?? "", f.diasVencidos == null ? "" : f.diasVencidos,
      f.situacion ? ETIQUETA_SITUACION[f.situacion] : "—", textoEstadoDocumento(f, true),
      celda(f.totalDocumento), celda(f.retencionIsr), celda(f.montoPagadero), celda(f.pagado), celda(f.saldo),
    ]);
    conFormato(r, [7, 8, 9, 10, 11]);
  }
  ws.columns = COLUMNAS_FACTURAS_ESTADO.map((h) => ({ width: Math.min(46, Math.max(14, h.length + 2)) }));

  if (d.pagosVisibles) {
    const wp = wb.addWorksheet("Pagos");
    wp.addRow([...COLUMNAS_PAGOS_ESTADO]).font = { bold: true };
    for (const f of d.filas) for (const l of f.pagos ?? []) {
      conFormato(wp.addRow([f.documento, l.fechaPago, l.medioPago, l.referencia, celda(l.monto), l.estado === "REGISTRADO" ? "Registrado" : "Reversado", l.vigente ? "Sí" : "No (solo información)", l.reversadoEn ?? "", l.motivoReversion ?? ""]), [5]);
    }
    wp.columns = COLUMNAS_PAGOS_ESTADO.map((h) => ({ width: Math.min(40, Math.max(14, h.length + 2)) }));
  }

  const wr = wb.addWorksheet("Resumen");
  const t = d.totales;
  wr.addRow(["Totales del conjunto filtrado (no solo de la página)", "Facturas", "Importe (GTQ)"]).font = { bold: true };
  const lin = (etq: string, n: number | "", v: string | "") => conFormato(wr.addRow([etq, n, v === "" ? "" : celda(v)]), [3]);
  lin("Total de documentos registrados", t.registradas.facturas, t.registradas.totalDocumento);
  lin("Retención de ISR (no es un pago)", "", t.registradas.retencionIsr);
  lin("Monto pagadero", "", t.registradas.montoPagadero);
  lin("Pagado vigente", "", t.registradas.pagado);
  lin("Saldo exigible", t.abiertas.facturas, t.registradas.saldoExigible);
  lin("Facturas pagadas (saldo 0.00)", t.pagadas.facturas, "");
  if (t.sobreaplicadas.facturas > 0) lin("Facturas sobreaplicadas (revisar; no cuentan como pagadas)", t.sobreaplicadas.facturas, t.sobreaplicadas.exceso);
  for (const s of t.porSituacion) lin(`Saldo ${ETIQUETA_SITUACION[s.situacion]}`, s.facturas, s.saldo);
  wr.addRow([]);
  wr.addRow(["Anuladas (informativo; no suman a ningún total, saldo exigible 0.00)", "Facturas", "Importe (GTQ)"]).font = { bold: true };
  lin("Total del documento anulado", t.anuladas.facturas, t.anuladas.totalDocumento);
  lin("Monto pagadero anulado", "", t.anuladas.montoPagadero);
  if (!d.pagosVisibles) { wr.addRow([]); wr.addRow([NOTA_SIN_PERMISO_PAGOS]); }
  if (d.advertencias.length) {
    wr.addRow([]);
    wr.addRow(["ADVERTENCIAS DE INTEGRIDAD (los importes originales no se modificaron)"]).font = { bold: true };
    for (const a of d.advertencias) wr.addRow([`${a.codigo}: ${a.mensaje}`]);
    if (d.advertenciasOmitidas > 0) wr.addRow([`… y ${d.advertenciasOmitidas} advertencia(s) más sin listar.`]);
  }
  wr.columns = [{ width: 70 }, { width: 12 }, { width: 22 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

import ExcelJS from "exceljs";
import type { TipoReporte } from "./http";
import type { balanceComprobacion, libroDiario, libroMayor } from "./reportes";

/** Excel de los reportes contables. Módulo cargado BAJO DEMANDA (import dinámico desde http.ts): ExcelJS no entra en la carga inicial. */
type Diario = Awaited<ReturnType<typeof libroDiario>>;
type Mayor = Awaited<ReturnType<typeof libroMayor>>;
type Balance = Awaited<ReturnType<typeof balanceComprobacion>>;
const moneda = '#,##0.00';

function cabecera(ws: ExcelJS.Worksheet, titulo: string, entidad: { codigo: string; nombre: string }, desde: string | null, hasta: string | null, extra?: string) {
  ws.addRow([titulo]).font = { bold: true, size: 14 };
  ws.addRow([`Entidad: ${entidad.codigo} — ${entidad.nombre}`]);
  ws.addRow([`Rango: ${desde ?? "inicio"} a ${hasta ?? "hoy"}`]);
  if (extra) ws.addRow([extra]);
  ws.addRow([]);
}
function encabezado(ws: ExcelJS.Worksheet, columnas: string[]) {
  const r = ws.addRow(columnas);
  r.font = { bold: true, color: { argb: "FFFFFFFF" } };
  r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
}
const num = (v: string) => Number(v);

export async function exportarXlsx(tipo: TipoReporte, datos: unknown): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(tipo === "diario" ? "Libro Diario" : tipo === "mayor" ? "Libro Mayor" : "Balance de comprobación");
  if (tipo === "diario") {
    const d = datos as Diario;
    cabecera(ws, "Libro Diario", d.entidad, d.desde, d.hasta, d.totalAsientos > d.asientos.length ? `Página ${d.page}: ${d.asientos.length} de ${d.totalAsientos} asientos.` : undefined);
    encabezado(ws, ["Asiento", "Fecha", "Glosa", "Cuenta", "Nombre de cuenta", "Debe", "Haber", "Usuario"]);
    for (const a of d.asientos) {
      for (const l of a.lineas) ws.addRow([a.numero, a.fecha, a.glosa ?? "", l.codigo ?? "(sin cuenta)", l.cuenta ?? "", num(l.debe), num(l.haber), a.usuario ?? ""]);
      const t = ws.addRow([`Total ${a.numero}${a.cuadra ? "" : " (NO CUADRA)"}`, "", "", "", "", num(a.totalDebe), num(a.totalHaber), ""]);
      t.font = { bold: true };
    }
    const t = ws.addRow(["Total del rango", "", "", "", "", num(d.totalesRango.debe), num(d.totalesRango.haber), `Diferencia ${d.totalesRango.diferencia}`]);
    t.font = { bold: true };
    ws.getColumn(6).numFmt = moneda; ws.getColumn(7).numFmt = moneda;
    [14, 12, 40, 14, 36, 16, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  } else if (tipo === "mayor") {
    const d = datos as Mayor;
    cabecera(ws, `Libro Mayor — ${d.cuenta.codigo} ${d.cuenta.nombre}`, d.entidad, d.desde, d.hasta, d.nota);
    encabezado(ws, ["Fecha", "Asiento", "Glosa", "Debe", "Haber", "Saldo acumulado"]);
    for (const m of d.movimientos) ws.addRow([m.fecha, m.numero, m.glosa ?? "", num(m.debe), num(m.haber), num(m.saldo)]);
    ws.addRow(["Totales", "", "", num(d.totales.debe), num(d.totales.haber), num(d.totales.saldoFinal)]).font = { bold: true };
    for (const c of [4, 5, 6]) ws.getColumn(c).numFmt = moneda;
    [12, 14, 44, 16, 16, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  } else {
    const d = datos as Balance;
    cabecera(ws, "Balance de comprobación", d.entidad, d.desde, d.hasta);
    encabezado(ws, ["Código", "Cuenta", "Débito", "Crédito", "Saldo deudor", "Saldo acreedor"]);
    for (const f of d.filas) ws.addRow([f.codigo, f.nombre, num(f.debito), num(f.credito), num(f.saldoDeudor), num(f.saldoAcreedor)]);
    ws.addRow(["Totales", "", num(d.totales.totalDebe), num(d.totales.totalHaber), num(d.totales.totalSaldoDeudor), num(d.totales.totalSaldoAcreedor)]).font = { bold: true };
    ws.addRow(["Diferencia debe − haber", "", num(d.totales.diferencia)]);
    for (const c of [3, 4, 5, 6]) ws.getColumn(c).numFmt = moneda;
    [14, 44, 16, 16, 16, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

import ExcelJS from "exceljs";
import { tablaAExcel } from "@/lib/rrhh/export-files";
import { formatearFechaVisible } from "@/lib/rrhh/dates";
import type { FilaAgregadaGasto, FilaRentabilidadViaje, FilaSolicitudFondoReporte, FilaViaticoReporte } from "@/lib/tms/reportes-gastos";
import type { SolicitudFondo } from "@/lib/tms/fondos";

/**
 * TMS-GASTOS-REPORTES-1 (fase 1) — reutiliza el exportador genérico
 * tablaAExcel (src/lib/rrhh/export-files.ts), ya usado por otros módulos
 * de la app — no se escribe un generador de Excel nuevo por reporte.
 */

const money = (n: number) => n.toFixed(2);

export async function exportarAgregadoGastosExcel(
  titulo: string,
  columnaEtiqueta: string,
  filas: FilaAgregadaGasto[],
): Promise<Buffer> {
  return tablaAExcel({
    sheetName: titulo,
    headers: [columnaEtiqueta, "Registros", "Total (Q)"],
    rows: filas.map((f) => [f.etiqueta, String(f.registros), money(f.totalMonto)]),
  });
}

export async function exportarViaticosReporteExcel(filas: FilaViaticoReporte[]): Promise<Buffer> {
  return tablaAExcel({
    sheetName: "Viaticos por viaje",
    headers: ["Viaje", "Fecha", "Persona", "Rol", "Monto sugerido (Q)", "Monto asignado (Q)", "Estado"],
    rows: filas.map((f) => [
      f.planCodigo, f.fechaPlan, f.personalNombre, f.rol, money(f.montoSugerido), money(f.montoAsignado), f.estado,
    ]),
  });
}

// TMS-SIN-COSTO-OPERATIVO-1: "Costo operativo" ya no se exporta — negocio
// confirmó que ya no se utiliza (fórmula de utilidad = tarifa - gastos -
// viáticos, ver reportes-gastos.ts).
export async function exportarRentabilidadExcel(filas: FilaRentabilidadViaje[]): Promise<Buffer> {
  return tablaAExcel({
    sheetName: "Rentabilidad por viaje",
    headers: ["Viaje", "Fecha", "Cliente", "Tarifario (Q)", "Gastos (Q)", "Viaticos (Q)", "Utilidad (Q)"],
    rows: filas.map((f) => [
      f.planCodigo, f.fechaPlan, f.clienteNombre ?? "—",
      money(f.tarifaComercial), money(f.gastos), money(f.viaticos), money(f.utilidad),
    ]),
  });
}

/**
 * SOLICITUD-FONDOS-REPORTE-1 — Excel del REPORTE de solicitudes de fondo
 * (filtrable: fecha solicitud/viaje, cliente, placa, empleado, cargo,
 * estado, descripción — ver reporteSolicitudesFondo en reportes-gastos.ts),
 * exactamente las filas que ya trae `filas` (mismo filtro que la
 * pantalla, nunca uno distinto) y EXACTAMENTE estas 9 columnas — nunca
 * ids internos:
 *   Fecha solicitud | Fecha viaje | Nombre | Cargo | Placa | Cliente |
 *   Cantidad | Descripción | Total
 *
 * Usa ExcelJS directamente (no el tablaAExcel genérico, que solo escribe
 * texto plano) para poder dar formato real: fechas dd/mm/yyyy, Total con
 * formato monetario GTQ, Cantidad numérica, autofiltro y anchos de
 * columna legibles — mismo estilo ya usado en rutas-export-excel.ts.
 */
export async function exportarReporteFondosExcel(filas: FilaSolicitudFondoReporte[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  const ws = wb.addWorksheet("Solicitudes de fondo", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });

  const headers = ["Código solicitud", "Estado", "Fecha solicitud", "Fecha viaje", "Nombre", "Cuenta", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Monto unitario", "Total línea", "Requirente", "Solicitante", "Autorizante", "Fecha autorización", "Total solicitud"];
  ws.addRow(headers);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle" };

  for (const f of filas) {
    ws.addRow([
      f.solicitudCodigo, f.estadoFondo,
      formatearFechaVisible(f.fechaSolicitud) || "—", f.fechaViaje ? formatearFechaVisible(f.fechaViaje) : "—",
      f.empleadoNombre ?? "—",
      f.cuenta ?? "—", f.cargo ?? "—", f.placa ?? "—", f.clienteNombre ?? "—",
      f.cantidad, f.descripcion ?? "—", f.monto, f.total,
      f.requirenteNombre ?? "—", f.solicitanteNombre ?? "—", f.autorizanteNombre ?? "—",
      f.fechaAutorizacion ? formatearFechaVisible(f.fechaAutorizacion) : "—", f.totalSolicitud,
    ]);
  }

  ws.autoFilter = { from: "A1", to: `R${Math.max(1, filas.length + 1)}` };
  ws.columns = [18,14,14,14,26,20,20,14,26,12,40,16,16,24,24,24,18,18].map((width) => ({ width }));
  ws.getColumn(10).numFmt = "0.00";
  for (const col of [12, 13, 18]) ws.getColumn(col).numFmt = '"Q"#,##0.00';
  ws.getColumn(11).alignment = { vertical: "top", wrapText: true };
  for (let i = 2; i <= filas.length + 1; i++) {
    for (let col = 1; col <= 18; col++) ws.getRow(i).getCell(col).alignment = { vertical: "top" };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportarSolicitudFondoExcel(solicitud: SolicitudFondo): Promise<Buffer> {
  return tablaAExcel({
    sheetName: `Solicitud ${solicitud.codigo}`.slice(0, 31),
    headers: ["Fecha solicitud", "Fecha viaje", "Nombre", "Cuenta", "Cargo", "Placa", "Cliente", "Categoría", "Cantidad", "Descripción", "Valor", "Subtotal (Q)"],
    rows: [
      ...solicitud.lineas.map((l) => [
        formatearFechaVisible(solicitud.fechaRequerimiento), l.fechaViaje ? formatearFechaVisible(l.fechaViaje) : "",
        l.empleadoNombre ?? "", l.cuenta ?? "", l.cargo ?? "", l.placa ?? "", l.clienteNombre ?? "",
        l.categoria, String(l.cantidad), l.descripcion ?? "", money(l.monto), money(l.cantidad * l.monto),
      ]),
      ["", "", "", "", "", "", "", "", "", "", "TOTAL", money(solicitud.total)],
    ],
  });
}

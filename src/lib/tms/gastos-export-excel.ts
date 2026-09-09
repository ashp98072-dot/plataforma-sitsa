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

  const headers = ["Fecha solicitud", "Fecha viaje", "Nombre", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Total"];
  ws.addRow(headers);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle" };

  for (const f of filas) {
    ws.addRow([
      formatearFechaVisible(f.fechaSolicitud) || "—",
      f.fechaViaje ? formatearFechaVisible(f.fechaViaje) : "—",
      f.empleadoNombre ?? "—",
      f.cargo ?? "—",
      f.placa ?? "—",
      f.clienteNombre ?? "—",
      f.cantidad,
      f.descripcion ?? "—",
      f.total,
    ]);
  }

  ws.autoFilter = { from: "A1", to: `I${Math.max(1, filas.length + 1)}` };
  ws.columns = [14, 14, 26, 20, 14, 26, 12, 40, 16].map((width) => ({ width }));
  ws.getColumn(7).numFmt = "0.00"; // Cantidad — numérica, admite fracciones (DECIMAL(10,2))
  ws.getColumn(7).alignment = { horizontal: "center", vertical: "top" };
  ws.getColumn(9).numFmt = "Q#,##0.00"; // Total — formato monetario GTQ
  ws.getColumn(9).alignment = { horizontal: "right", vertical: "top" };
  ws.getColumn(8).alignment = { vertical: "top", wrapText: true }; // Descripción — puede ser texto largo
  for (let i = 2; i <= filas.length + 1; i++) {
    for (const col of [1, 2, 3, 4, 5, 6]) ws.getRow(i).getCell(col).alignment = { vertical: "top" };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportarSolicitudFondoExcel(solicitud: SolicitudFondo): Promise<Buffer> {
  return tablaAExcel({
    sheetName: `Solicitud ${solicitud.codigo}`.slice(0, 31),
    headers: ["Categoria", "Descripcion", "Cantidad", "Monto (Q)", "Subtotal (Q)"],
    rows: [
      ...solicitud.lineas.map((l) => [
        l.categoria, l.descripcion ?? "", String(l.cantidad), money(l.monto), money(l.cantidad * l.monto),
      ]),
      ["", "", "", "TOTAL", money(solicitud.total)],
    ],
  });
}

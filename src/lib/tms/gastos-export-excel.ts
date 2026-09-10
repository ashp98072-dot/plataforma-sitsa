import ExcelJS from "exceljs";
import { tablaAExcel } from "@/lib/rrhh/export-files";
import { formatearFechaVisible } from "@/lib/rrhh/dates";
import { resumirViaticosPorEstado, type FilaAgregadaGasto, type FilaGastoDetalle, type FilaRentabilidadViaje, type FilaSolicitudFondoReporte, type FilaViaticoReporte } from "@/lib/tms/reportes-gastos";
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

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 (§1/§5 del ticket) — detalle
 * completo, una fila por viático (nunca solo un resumen agregado).
 * ExcelJS directo (no tablaAExcel, que solo escribe texto plano) para
 * fechas como fecha visible, montos con formato Q, encabezado congelado
 * y autofiltro — mismo estilo ya usado en exportarReporteFondosExcel.
 * Al final: fila en blanco, TOTAL GENERAL (cantidad + suma de monto
 * asignado) y un total por cada estado presente en el resultado.
 */
export async function exportarViaticosReporteExcel(filas: FilaViaticoReporte[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  const ws = wb.addWorksheet("Viaticos", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });

  const headers = [
    "Fecha registro", "Fecha viaje", "Código viaje", "Ruta / destino",
    "Nombre", "Cargo", "Cuenta bancaria", "Placa", "Cliente", "Concepto",
    "Monto sugerido", "Monto asignado", "Estado",
    "Fecha autorización", "Autorizado por", "Fecha entrega", "Entregado por", "Observaciones",
  ];
  ws.addRow(headers);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle" };

  for (const f of filas) {
    ws.addRow([
      formatearFechaVisible(f.fechaRegistro) || "—", formatearFechaVisible(f.fechaViaje) || "—",
      f.planCodigo, f.rutaDestino ?? "—",
      f.personalNombre, f.cargo ?? "—", f.cuentaBancaria ?? "—", f.placa ?? "—", f.clienteNombre ?? "—", f.rol,
      f.montoSugerido, f.montoAsignado, f.estado,
      f.fechaAutorizacion ? formatearFechaVisible(f.fechaAutorizacion) : "—", f.autorizadoPor ?? "—",
      f.fechaEntrega ? formatearFechaVisible(f.fechaEntrega) : "—", f.entregadoPor ?? "—",
      f.observaciones ?? "—",
    ]);
  }

  const ultimaFilaDatos = filas.length + 1;
  ws.autoFilter = { from: "A1", to: `R${Math.max(1, ultimaFilaDatos)}` };
  ws.columns = [14, 14, 16, 26, 24, 18, 18, 12, 22, 12, 16, 16, 14, 16, 20, 14, 20, 30].map((width) => ({ width }));
  for (const col of [11, 12]) ws.getColumn(col).numFmt = '"Q"#,##0.00';
  ws.getColumn(18).alignment = { vertical: "top", wrapText: true };
  for (let i = 2; i <= ultimaFilaDatos; i++) {
    for (let col = 1; col <= headers.length; col++) ws.getRow(i).getCell(col).alignment = { vertical: "top" };
  }

  // §1 del ticket: total general + totales por estado + cantidad de registros.
  ws.addRow([]);
  const totalGeneral = filas.reduce((s, f) => s + f.montoAsignado, 0);
  const filaTotal = ws.addRow(["", "", "", "", "", "", "", "", "", "TOTAL GENERAL", "", totalGeneral, `${filas.length} registro(s)`]);
  filaTotal.font = { bold: true };
  filaTotal.getCell(12).numFmt = '"Q"#,##0.00';
  const resumen = resumirViaticosPorEstado(filas);
  for (const [estado, { cantidad, total }] of Object.entries(resumen)) {
    const fila = ws.addRow(["", "", "", "", "", "", "", "", "", `Total ${estado}`, "", total, `${cantidad} registro(s)`]);
    fila.getCell(12).numFmt = '"Q"#,##0.00';
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 (§2/§5 del ticket) — detalle de
 * Gastos Operativos, una fila por gasto (nunca agrupado). Mismo estilo
 * ExcelJS que exportarViaticosReporteExcel: fechas visibles, montos con
 * formato Q, encabezado congelado, autofiltro, y al final TOTAL GENERAL
 * (cantidad + suma de `total`).
 */
export async function exportarGastosDetalleExcel(filas: FilaGastoDetalle[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  const ws = wb.addWorksheet("Gastos", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });

  // GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — primero las 9 columnas exigidas
  // por el ticket en ese orden (Fecha solicitud, Fecha viaje, Nombre,
  // Cargo, Placa, Cliente, Cantidad, Descripción, Total) y luego el resto
  // del detalle operativo. "Descuento personal" es un indicador operativo,
  // sin efecto en planilla/nómina.
  const headers = [
    "Fecha solicitud", "Fecha de viaje", "Nombre", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Total",
    "Código viaje", "Categoría", "Monto unitario", "Estado", "Descuento personal", "Registrado por", "Observaciones",
  ];
  ws.addRow(headers);
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  header.alignment = { horizontal: "center", vertical: "middle" };

  for (const f of filas) {
    ws.addRow([
      formatearFechaVisible(f.fechaSolicitud) || "—", f.fechaViaje ? formatearFechaVisible(f.fechaViaje) : "—",
      f.empleadoNombre ?? "—", f.cargo ?? "—", f.placa ?? "—", f.clienteNombre ?? "—",
      f.cantidad, f.descripcion ?? "—", f.total,
      f.planCodigo ?? "—", f.categoria, f.monto,
      f.activo ? "Activo" : "Anulado", f.descuentoPersonal ? "Sí" : "No", f.registradoPor ?? "—", f.observaciones ?? "—",
    ]);
  }

  const ultimaFilaDatos = filas.length + 1;
  ws.autoFilter = { from: "A1", to: `P${Math.max(1, ultimaFilaDatos)}` };
  ws.columns = [14, 14, 26, 18, 12, 24, 12, 40, 16, 16, 16, 16, 12, 16, 20, 30].map((width) => ({ width }));
  ws.getColumn(7).numFmt = "0.00";
  for (const col of [9, 12]) ws.getColumn(col).numFmt = '"Q"#,##0.00';
  ws.getColumn(8).alignment = { vertical: "top", wrapText: true };
  ws.getColumn(16).alignment = { vertical: "top", wrapText: true };
  for (let i = 2; i <= ultimaFilaDatos; i++) {
    for (let col = 1; col <= headers.length; col++) {
      if (col !== 8 && col !== 16) ws.getRow(i).getCell(col).alignment = { vertical: "top" };
    }
  }

  ws.addRow([]);
  const totalGeneral = filas.reduce((s, f) => s + f.total, 0);
  const filaTotal = ws.addRow(["", "", "", "", "", "", "", "TOTAL GENERAL", totalGeneral, `${filas.length} registro(s)`]);
  filaTotal.font = { bold: true };
  filaTotal.getCell(9).numFmt = '"Q"#,##0.00';

  return Buffer.from(await wb.xlsx.writeBuffer());
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

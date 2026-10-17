import ExcelJS from "exceljs";
import type { PlanReporte } from "@/lib/tms/reportes-viajes";
import { badgeLiquidacion } from "@/lib/tms/liquidacion-viaje-shared";
import { textoCuadrilla } from "@/lib/tms/cuadrilla-contrato";
import type { IntegranteCuadrilla } from "@/lib/tms/cuadrilla-contrato";
import { textoVehiculoSolicitado } from "@/lib/tms/vehiculo-solicitado";

/**
 * PLANES / VIAJES — exportación a Excel (una fila por viaje) con el modelo de reporte que ya alimenta la pantalla (`PlanReporte`).
 * Lectura pura: no consulta ni escribe nada; recibe las filas ya resueltas por el exportador del servidor (TODO el filtro, no una página).
 *
 * Tipos reales en las celdas: fechas como fecha, horas como fecha/hora, km/evidencias/montos como NÚMEROS (sin «Q» en el valor; el formato de
 * celda lo muestra). Vehículo solicitado = fotografía guardada en el viaje (nunca se infiere de la placa): sin dato, «—».
 */
export const SHEET_PLANES_VIAJES = "Planes-Viajes";

type Columna = { header: string; width: number; fmt?: string; wrap?: boolean };
export const COLUMNAS_PLANES_VIAJES: Columna[] = [
  { header: "Código", width: 22 },
  { header: "Fecha", width: 12, fmt: "dd/mm/yyyy" },
  { header: "Cliente", width: 30, wrap: true },
  { header: "Ruta", width: 18, wrap: true },
  { header: "Vehículo solicitado", width: 24, wrap: true },
  { header: "Placa / Unidad", width: 16 },
  { header: "Piloto", width: 26, wrap: true },
  { header: "Piloto extra", width: 26, wrap: true },
  { header: "Auxiliares", width: 28, wrap: true },
  { header: "Cuadrilla", width: 34, wrap: true },
  { header: "Hora salida", width: 17, fmt: "dd/mm/yyyy hh:mm" },
  { header: "Hora llegada", width: 17, fmt: "dd/mm/yyyy hh:mm" },
  { header: "Km salida", width: 12, fmt: "#,##0" },
  { header: "Km llegada", width: 12, fmt: "#,##0" },
  { header: "Km recorridos", width: 13, fmt: "#,##0" },
  { header: "Evidencias", width: 11, fmt: "0" },
  { header: "Tarifa usada", width: 24, wrap: true },
  { header: "Tarifa comercial", width: 16, fmt: '"Q"#,##0.00' },
  { header: "Cargos adicionales", width: 17, fmt: '"Q"#,##0.00' },
  { header: "Subtotal comercial", width: 17, fmt: '"Q"#,##0.00' },
  { header: "Estado del viaje", width: 22, wrap: true },
  { header: "Estado de liquidación", width: 24, wrap: true },
  { header: "Estado factura", width: 24, wrap: true },
  { header: "Número factura", width: 16 },
  { header: "Monto facturado", width: 16, fmt: '"Q"#,##0.00' },
  { header: "Estado cobro", width: 16 },
  { header: "Total factura", width: 16, fmt: '"Q"#,##0.00' },
  { header: "Cobrado", width: 16, fmt: '"Q"#,##0.00' },
  { header: "Saldo", width: 16, fmt: '"Q"#,##0.00' },
];

const SIN_DATO = "—";

/** «YYYY-MM-DD» → fecha (medianoche UTC, sin corrimiento de zona). Sin forma válida devuelve el texto. */
export function fechaCelda(valor: string | null | undefined): Date | string | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  if (!m) return valor;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isFinite(d.getTime()) ? d : valor;
}

/** «YYYY-MM-DD[T ]HH:mm[:ss]» (reloj de pared de Guatemala) → fecha/hora sin reinterpretar la zona. */
export function fechaHoraCelda(valor: string | null | undefined): Date | string | null {
  if (!valor) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(valor);
  if (!m) return valor;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])));
  return Number.isFinite(d.getTime()) ? d : valor;
}

const numero = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function filaPlanViajeExcel(p: PlanReporte, cuadrilla: IntegranteCuadrilla[] = []): (string | number | Date | null)[] {
  const montoFacturado = p.montoFacturadoViaje ?? p.montoBorradorViaje; // igual que la columna «Monto fact.» de la pantalla
  return [
    p.codigo,
    fechaCelda(p.fechaPlan),
    p.cliente ?? SIN_DATO,
    p.rutaCodigo ?? SIN_DATO,
    textoVehiculoSolicitado(p.vehiculoSolicitado), // fotografía del viaje; históricos sin dato => «—»
    p.placa ?? SIN_DATO,
    p.piloto ?? SIN_DATO,
    p.pilotoExtra ?? "",
    p.auxiliares.join("\n"),
    textoCuadrilla(cuadrilla),
    fechaHoraCelda(p.horaSalida),
    fechaHoraCelda(p.horaLlegada),
    numero(p.kmSalida),
    numero(p.kmLlegada),
    numero(p.kmRecorridos),
    numero(p.evidencias) ?? 0,
    p.tarifaNombre ?? SIN_DATO,
    numero(p.tarifaComercial),
    numero(p.cargosAdicionales?.total) ?? 0,
    numero(p.subtotalComercial),
    p.pendienteCierre && p.estado !== "Cerrado" && p.estado !== "Cancelado" ? `${p.estado} (pendiente de cierre)` : p.estado,
    badgeLiquidacion(p.liquidacion, p.estado)?.texto ?? SIN_DATO,
    p.estadoFacturacion,
    p.numeroFactura ?? SIN_DATO,
    numero(montoFacturado),
    p.estadoFinancieroFactura ?? SIN_DATO,
    numero(p.totalFactura),
    numero(p.totalPagadoFactura),
    numero(p.saldoFactura),
  ];
}

export async function planesViajesAExcel(planes: PlanReporte[], cuadrillaPorPlan: Map<number, IntegranteCuadrilla[]> = new Map()): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Plataforma corporativa";
  const ws = wb.addWorksheet(SHEET_PLANES_VIAJES, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(COLUMNAS_PLANES_VIAJES.map((c) => c.header));
  const cab = ws.getRow(1);
  cab.font = { bold: true, color: { argb: "FFFFFFFF" } };
  cab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  cab.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cab.height = 30;
  for (const p of planes) ws.addRow(filaPlanViajeExcel(p, cuadrillaPorPlan.get(p.id) ?? []));
  ws.columns = COLUMNAS_PLANES_VIAJES.map((c) => ({ width: c.width }));
  COLUMNAS_PLANES_VIAJES.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.fmt) col.numFmt = c.fmt;
    col.alignment = { vertical: "top", wrapText: Boolean(c.wrap) };
  });
  cab.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; // la columna pisó la alineación de la cabecera
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, planes.length + 1), column: COLUMNAS_PLANES_VIAJES.length } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** `planes-viajes_2026-10-01_al_2026-10-17.xlsx` si el filtro trae rango completo; si no, `planes-viajes_<hoy>.xlsx`. */
export function nombreArchivoPlanesViajes(filtros: { fechaDesde?: string | null; fechaHasta?: string | null }, hoy: string): string {
  const f = /^\d{4}-\d{2}-\d{2}$/;
  if (filtros.fechaDesde && filtros.fechaHasta && f.test(filtros.fechaDesde) && f.test(filtros.fechaHasta)) {
    return `planes-viajes_${filtros.fechaDesde}_al_${filtros.fechaHasta}.xlsx`;
  }
  return `planes-viajes_${hoy}.xlsx`;
}

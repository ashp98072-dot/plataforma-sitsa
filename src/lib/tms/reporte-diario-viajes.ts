import { formatearFechaHora12, formatearHora12 } from "@/lib/tms/hora-formato";
import { textoPilotos } from "@/lib/tms/piloto-extra-comun";

export type ViajeDiario = {
  fechaPlan: string;
  cliente: string | null;
  unidadTipo: string | null;
  placa: string | null;
  rutaCodigo: string | null;
  lugarDescargaHistorico: string | null;
  horaSalida: string | null;
  horaCarga: string | null;
  piloto: string | null;
  /** Piloto extra (si tiene): la celda de Piloto queda "Principal / Extra". */
  pilotoExtra?: string | null;
  auxiliares: string[];
  estado: string;
  tarifaComercial: number | null;
};

export const HEADERS_REPORTE_DIARIO = [
  "Día", "Cliente", "Unidad", "Placa", "Ruta", "Hora de salida",
  "Piloto", "Auxiliar 1", "Auxiliar 2", "Estado", "Tarifa comercial / valor del viaje",
];

/**
 * OPERACIONES-HORA-12H-1 (Grupo C) — `horaSalida` (real, cuando ya
 * existe) y `horaCarga` (programada, fallback) tienen formas DISTINTAS:
 * la primera es fecha+hora completa (`YYYY-MM-DDTHH:mm`, misma consulta
 * que reportes-viajes.ts), la segunda es `HH:mm[:ss]` plano sin fecha —
 * por eso cada una usa el helper compartido que le corresponde
 * (formatearFechaHora12 / formatearHora12) en vez de una sola conversión
 * genérica que asumiría una sola forma para las dos.
 */
function horaMostrada(horaSalidaReal: string | null, horaProgramada: string | null): string {
  if (horaSalidaReal) return formatearFechaHora12(horaSalidaReal);
  if (horaProgramada) return formatearHora12(horaProgramada);
  return "—";
}

export function filaReporteDiario(v: ViajeDiario): string[] {
  return [
    v.fechaPlan,
    v.cliente ?? "—",
    v.unidadTipo ?? "—",
    v.placa ?? "—",
    v.rutaCodigo ?? v.lugarDescargaHistorico ?? "—",
    horaMostrada(v.horaSalida, v.horaCarga),
    textoPilotos(v.piloto, v.pilotoExtra) || "—",
    v.auxiliares[0] ?? "—",
    v.auxiliares[1] ?? "—",
    v.estado,
    v.tarifaComercial == null ? "—" : String(v.tarifaComercial),
  ];
}

export function totalValorViajes(viajes: ViajeDiario[]): number {
  return viajes.reduce((total, viaje) =>
    viaje.estado === "Cancelado" ? total : total + (viaje.tarifaComercial ?? 0), 0);
}

export function cantidadPaginasReporte(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isInteger(pageSize) || pageSize <= 0 || total <= 0) return 0;
  return Math.ceil(total / pageSize);
}

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
  auxiliares: string[];
  estado: string;
  tarifaComercial: number | null;
};

export const HEADERS_REPORTE_DIARIO = [
  "Día", "Cliente", "Unidad", "Placa", "Ruta", "Hora de salida",
  "Piloto", "Auxiliar 1", "Auxiliar 2", "Estado", "Tarifa comercial / valor del viaje",
];

export function filaReporteDiario(v: ViajeDiario): string[] {
  return [
    v.fechaPlan,
    v.cliente ?? "—",
    v.unidadTipo ?? "—",
    v.placa ?? "—",
    v.rutaCodigo ?? v.lugarDescargaHistorico ?? "—",
    (v.horaSalida ?? v.horaCarga ?? "—").replace("T", " "),
    v.piloto ?? "—",
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

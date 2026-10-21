import { z } from "zod";
import { fechaCalendario } from "./viaticos-agrupacion";

export const ESTADOS_REPORTE = {
  PROGRAMADO: "por autorizar",
  AUTORIZADO: "autorizados",
  RECHAZADO: "rechazados",
  ENTREGADO: "entregados",
  LIQUIDADO: "liquidados",
  TODOS: "(todos los estados)",
} as const;
export type EstadoReporte = keyof typeof ESTADOS_REPORTE;
const fecha = z.string().refine((v) => !v || fechaCalendario(v) === v, "Fecha inválida");
export const filtrosReporteSchema = z.object({
  estado: z.enum(["PROGRAMADO", "AUTORIZADO", "RECHAZADO", "ENTREGADO", "LIQUIDADO", "TODOS"]),
  busqueda: z.string().trim().max(200).default(""),
  empleado: z.string().trim().max(200).default(""),
  rol: z.enum(["", "Piloto", "Auxiliar"]).default(""),
  metodo: z.enum(["", "EFECTIVO", "TRANSFERENCIA", "CHEQUE"]).default(""),
  fechaDesde: fecha.default(""),
  fechaHasta: fecha.default(""),
  agrupacion: z.enum(["DIA", "SEMANA", "MES"]).default("DIA"),
}).refine((f) => !f.fechaDesde || !f.fechaHasta || f.fechaDesde <= f.fechaHasta, "Rango de fechas inválido");
export type FiltrosReporteViaticos = z.infer<typeof filtrosReporteSchema>;
export const tituloReporte = (estado: EstadoReporte) => `Reporte de viáticos ${ESTADOS_REPORTE[estado]}`;
export const mensajeSinDatos = (estado: EstadoReporte) => `No hay viáticos ${ESTADOS_REPORTE[estado]} en el período seleccionado.`;

/** Mismo criterio de búsqueda/rol/método en pantalla y en ambos formatos. */
export function coincideFiltroReporte(
  r: { planCodigo: string; cliente: string | null; personalNombre: string; rol: string; metodoPago: string | null },
  f: { busqueda: string; rol: string; metodo: string },
): boolean {
  const t = f.busqueda.trim().toLowerCase();
  return (!t || [r.planCodigo, r.cliente ?? "", r.personalNombre].some((v) => v.toLowerCase().includes(t)))
    && (!f.rol || r.rol === f.rol) && (!f.metodo || r.metodoPago === f.metodo);
}

export function descripcionFiltros(f: FiltrosReporteViaticos): string {
  return [
    `Estado: ${ESTADOS_REPORTE[f.estado]}`,
    `Desde: ${f.fechaDesde || "sin límite"}`, `Hasta: ${f.fechaHasta || "sin límite"}`,
    `Viaje / cliente / empleado: ${f.busqueda || "todos"}`,
    `Empleado (servidor): ${f.empleado || "todos"}`, `Rol: ${f.rol || "todos"}`,
    `Método: ${f.metodo || "todos"}`, `Agrupar por: ${f.agrupacion}`,
  ].join(" · ");
}

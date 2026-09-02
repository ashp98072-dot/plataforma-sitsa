import type { EstadoViajePortal } from "@/lib/tms/cliente-portal-seguimiento";

/**
 * CLIENTE-PORTAL-4 — mapeo de EstadoViajePortal a texto/estilo visual,
 * mismo patrón que solicitudes-cliente-ui.ts (CLIENTE-PORTAL-2): puramente
 * presentación, sin acceso a base de datos. El dominio
 * (cliente-portal-seguimiento.ts) mantiene el estado real; esto solo
 * traduce la representación ya simplificada del portal a algo legible.
 */
export const ESTADO_VIAJE_LABELS: Record<EstadoViajePortal, string> = {
  PROGRAMADO: "Programado",
  EN_RUTA: "En ruta",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
  DESCONOCIDO: "Estado por confirmar",
};

export function etiquetaEstadoViaje(estado: string): string {
  return (ESTADO_VIAJE_LABELS as Record<string, string>)[estado] ?? estado;
}

const ESTADO_VIAJE_CLASES: Record<EstadoViajePortal, string> = {
  PROGRAMADO: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  EN_RUTA: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  FINALIZADO: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  CANCELADO: "bg-gray-500/15 text-gray-600 dark:text-gray-300",
  DESCONOCIDO: "bg-gray-500/15 text-gray-600 dark:text-gray-300",
};

export function claseEstadoViaje(estado: string): string {
  return (ESTADO_VIAJE_CLASES as Record<string, string>)[estado] ?? "bg-gray-500/15 text-gray-600";
}

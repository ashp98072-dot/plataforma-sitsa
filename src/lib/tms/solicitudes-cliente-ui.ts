import type { EstadoSolicitudCliente } from "@/lib/tms/solicitudes-cliente";

/**
 * CLIENTE-PORTAL-2 (sección 12) — mapeo de estados a texto/estilo visual
 * para el Portal del Cliente. Puramente sincrónico, sin acceso a base de
 * datos — el cliente NUNCA puede cambiar manualmente a EN_REVISION/
 * PROGRAMADA/RECHAZADA (no hay ningún endpoint que lo permita); esto es
 * solo presentación de lo que ya viene de la base de datos.
 */
export const ESTADO_SOLICITUD_LABELS: Record<EstadoSolicitudCliente, string> = {
  SOLICITADA: "Solicitud enviada",
  EN_REVISION: "En revisión",
  PROGRAMADA: "Programada",
  RECHAZADA: "Rechazada",
  CANCELADA: "Cancelada",
};

export function etiquetaEstadoSolicitud(estado: string): string {
  return (ESTADO_SOLICITUD_LABELS as Record<string, string>)[estado] ?? estado;
}

const ESTADO_CLASES: Record<EstadoSolicitudCliente, string> = {
  SOLICITADA: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  EN_REVISION: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  PROGRAMADA: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  RECHAZADA: "bg-red-500/15 text-red-700 dark:text-red-300",
  CANCELADA: "bg-gray-500/15 text-gray-600 dark:text-gray-300",
};

export function claseEstadoSolicitud(estado: string): string {
  return (ESTADO_CLASES as Record<string, string>)[estado] ?? "bg-gray-500/15 text-gray-600";
}

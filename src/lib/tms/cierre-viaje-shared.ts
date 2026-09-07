/** Estados desde los que Operaciones puede solicitar un cierre manual. */
export const ESTADOS_CIERRE_MANUAL = ["Programado", "Cargado", "En ruta"] as const;

/** Criterio puro compartido por la interfaz y el backend. */
export function puedeCerrarManualmente(estado: string): boolean {
  return (ESTADOS_CIERRE_MANUAL as readonly string[]).includes(estado);
}

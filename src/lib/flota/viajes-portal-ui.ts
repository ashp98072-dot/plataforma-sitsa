import type { AsignacionOperativaPortal } from "@/lib/flota/viajes-piloto";

const ESTADOS_FINALIZADOS = new Set(["cerrado", "cancelado"]);

export function viajePortalFinalizado(viaje: AsignacionOperativaPortal) {
  return ESTADOS_FINALIZADOS.has(viaje.estado.trim().toLocaleLowerCase("es-GT"))
    || viaje.viajeEstado?.trim().toLocaleLowerCase("es-GT") === "cerrado";
}

function instante(viaje: AsignacionOperativaPortal) {
  return `${viaje.fecha}T${viaje.horaSalida ?? "00:00:00"}`;
}

/** Separa la operación vigente del historial sin modificar el arreglo recibido. */
export function separarViajesPortal(asignaciones: AsignacionOperativaPortal[]) {
  const pendientes = asignaciones
    .filter((viaje) => !viajePortalFinalizado(viaje))
    .sort((a, b) => Number(b.viajeEstado === "abierto") - Number(a.viajeEstado === "abierto")
      || instante(a).localeCompare(instante(b)));
  const finalizados = asignaciones
    .filter(viajePortalFinalizado)
    .sort((a, b) => instante(b).localeCompare(instante(a)));

  return { pendientes, finalizados };
}

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

export function paginarViajesPortal(
  viajes: AsignacionOperativaPortal[],
  paginaSolicitada: number,
  porPagina = 8,
) {
  const totalPaginas = Math.max(1, Math.ceil(viajes.length / porPagina));
  const pagina = Math.min(Math.max(1, Math.trunc(paginaSolicitada) || 1), totalPaginas);
  const inicio = (pagina - 1) * porPagina;
  return {
    viajes: viajes.slice(inicio, inicio + porPagina),
    pagina,
    totalPaginas,
    desde: viajes.length ? inicio + 1 : 0,
    hasta: Math.min(inicio + porPagina, viajes.length),
  };
}

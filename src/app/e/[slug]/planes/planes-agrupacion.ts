import { puedeCerrarManualmente, puedeCerrarNormalmente } from "@/lib/tms/cierre-viaje-shared";

/**
 * TMS-CIERRE-MASIVO-1 — lógica PURA de la vista operativa de Planes / Viajes:
 * agrupación visual por fecha, elegibilidad de cierre y resumen de selección.
 * Es solo organización de los MISMOS datos (sin persistencia nueva). La
 * elegibilidad usa los criterios compartidos con el backend
 * (cierre-viaje-shared.ts); el servidor SIEMPRE vuelve a validar.
 */
export type PlanAgrupable = { id: number; fechaPlan: string; estado: string; pendienteCierre: boolean };

/**
 * `pendienteCierre` del listado = no Cerrado/Cancelado Y existe llegada real
 * (flota_viajes 'cerrado'), por lo que equivale a "llegada registrada". El
 * cierre NORMAL además admite Descargado sin ese dato (ver puedeCerrarNormalmente).
 */
export function elegibilidadCierre(p: Pick<PlanAgrupable, "estado" | "pendienteCierre">, puedeCerrarViaje: boolean): { normal: boolean; manual: boolean } {
  if (!puedeCerrarViaje) return { normal: false, manual: false };
  return {
    normal: puedeCerrarNormalmente(p.estado, p.pendienteCierre),
    manual: puedeCerrarManualmente(p.estado),
  };
}

/** Un viaje se puede seleccionar si admite ALGUNO de los dos cierres (Cerrado/Cancelado/sin permiso: nunca). */
export function esSeleccionable(p: Pick<PlanAgrupable, "estado" | "pendienteCierre">, puedeCerrarViaje: boolean): boolean {
  const e = elegibilidadCierre(p, puedeCerrarViaje);
  return e.normal || e.manual;
}

export type GrupoFecha<T extends PlanAgrupable> = {
  fecha: string;
  planes: T[];
  total: number;
  /** Con cierre normal disponible. */
  cerrables: number;
  cerrados: number;
  otros: number;
};

/** Grupos por fechaPlan, fecha DESC; dentro de cada fecha se conserva el orden del backend (orden estable). */
export function agruparPorFecha<T extends PlanAgrupable>(planes: T[]): GrupoFecha<T>[] {
  const mapa = new Map<string, T[]>();
  for (const p of planes) {
    const f = String(p.fechaPlan ?? "").slice(0, 10);
    const lista = mapa.get(f);
    if (lista) lista.push(p); else mapa.set(f, [p]);
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([fecha, lista]) => {
      const cerrables = lista.filter((p) => puedeCerrarNormalmente(p.estado, p.pendienteCierre)).length;
      const cerrados = lista.filter((p) => p.estado === "Cerrado").length;
      return { fecha, planes: lista, total: lista.length, cerrables, cerrados, otros: lista.length - cerrables - cerrados };
    });
}

/** Por defecto solo el día más reciente queda abierto (y el que contiene el plan enfocado por deep-link). */
export function grupoAbierto(
  indice: number,
  fecha: string,
  toggles: Record<string, boolean>,
  contieneFoco: boolean,
): boolean {
  return toggles[fecha] ?? (indice === 0 || contieneFoco);
}

/** Paginación server-side: una fecha puede partirse entre páginas; solo los grupos de los bordes pueden estar incompletos. */
export function notaPaginacionGrupo(indice: number, totalGrupos: number, pagina: number, totalPaginas: number): string | null {
  const continuaAntes = indice === 0 && pagina > 1;
  const continuaDespues = indice === totalGrupos - 1 && pagina < totalPaginas;
  if (continuaAntes && continuaDespues) return "Este día puede continuar en la página anterior y en la siguiente.";
  if (continuaAntes) return "Este día puede continuar en la página anterior.";
  if (continuaDespues) return "Este día puede continuar en la página siguiente.";
  return null;
}

export type ResumenSeleccion = {
  seleccionados: number;
  normal: { elegibles: number; noElegibles: number; ids: number[] };
  manual: { elegibles: number; noElegibles: number; ids: number[] };
};

/** Qué seleccionados admite cada tipo de cierre masivo (para los botones y los modales). */
export function resumenSeleccion<T extends PlanAgrupable>(planes: T[], seleccion: ReadonlySet<number>, puedeCerrarViaje: boolean): ResumenSeleccion {
  const sel = planes.filter((p) => seleccion.has(p.id));
  const normalIds = sel.filter((p) => elegibilidadCierre(p, puedeCerrarViaje).normal).map((p) => p.id);
  const manualIds = sel.filter((p) => elegibilidadCierre(p, puedeCerrarViaje).manual).map((p) => p.id);
  return {
    seleccionados: sel.length,
    normal: { elegibles: normalIds.length, noElegibles: sel.length - normalIds.length, ids: normalIds },
    manual: { elegibles: manualIds.length, noElegibles: sel.length - manualIds.length, ids: manualIds },
  };
}

/** "Seleccionar elegibles" de un día: solo viajes que admiten algún cierre. */
export function idsSeleccionables<T extends PlanAgrupable>(planes: T[], puedeCerrarViaje: boolean): number[] {
  return planes.filter((p) => esSeleccionable(p, puedeCerrarViaje)).map((p) => p.id);
}

export const fechaVisible = (f: string) => f.slice(0, 10).split("-").reverse().join("/");

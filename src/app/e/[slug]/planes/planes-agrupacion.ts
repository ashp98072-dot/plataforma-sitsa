import { puedeCerrarManualmente, puedeCerrarNormalmente } from "@/lib/tms/cierre-viaje-shared";
import { claveAgrupacion, resolverPeriodoPlanes, type AgrupacionPlanes } from "@/lib/tms/planes-periodo";

export type { AgrupacionPlanes };

/**
 * TMS-CIERRE-MASIVO-1 (generalizado en PLANES-CIERRE-PERIODO) — lógica PURA de la vista operativa de
 * Planes / Viajes: agrupación visual por Día/Semana/Mes, elegibilidad de cierre y resumen de selección. Es solo
 * organización de los MISMOS datos de la página YA CARGADA (sin persistencia nueva) — el cierre por período
 * COMPLETO (más allá de esta página) lo resuelve el backend (candidatos-cierre / cerrarViajesMasivoPorPeriodo),
 * nunca esta agrupación client-side. La elegibilidad usa los criterios compartidos con el backend
 * (cierre-viaje-shared.ts); el servidor SIEMPRE vuelve a validar.
 */
/** PLANES-TARIFA-CIERRE-1 — `tarifaComercial: number | null`; elegibilidadCierre exige `!== null`, nunca `> 0`. */
export type PlanAgrupable = { id: number; fechaPlan: string; estado: string; pendienteCierre: boolean; tarifaComercial: number | null };

/**
 * `pendienteCierre` del listado = no Cerrado/Cancelado Y existe llegada real
 * (flota_viajes 'cerrado'), por lo que equivale a "llegada registrada". El
 * cierre NORMAL además admite Descargado sin ese dato (ver puedeCerrarNormalmente).
 *
 * PLANES-TARIFA-CIERRE-1 — sin tarifa (`tarifaComercial === null`), NINGÚN cierre es elegible, sin importar
 * estado/llegada — mismo criterio puro que el backend (cierre-viaje-shared.ts).
 */
export function elegibilidadCierre(p: Pick<PlanAgrupable, "estado" | "pendienteCierre" | "tarifaComercial">, puedeCerrarViaje: boolean): { normal: boolean; manual: boolean } {
  if (!puedeCerrarViaje) return { normal: false, manual: false };
  const tieneTarifa = p.tarifaComercial != null;
  return {
    normal: puedeCerrarNormalmente(p.estado, p.pendienteCierre, tieneTarifa),
    manual: puedeCerrarManualmente(p.estado, tieneTarifa),
  };
}

/** Un viaje se puede seleccionar si admite ALGUNO de los dos cierres (Cerrado/Cancelado/sin permiso/sin tarifa: nunca). */
export function esSeleccionable(p: Pick<PlanAgrupable, "estado" | "pendienteCierre" | "tarifaComercial">, puedeCerrarViaje: boolean): boolean {
  const e = elegibilidadCierre(p, puedeCerrarViaje);
  return e.normal || e.manual;
}

export type GrupoPlanes<T extends PlanAgrupable> = {
  /** "2026-09-30" | "2026-W40" | "2026-09" — mismo formato que planes-periodo.ts. */
  clave: string;
  /** Texto humano: "30/09/2026" | "Semana 40 · 28/09/2026 al 04/10/2026" | "Septiembre 2026". */
  etiqueta: string;
  planes: T[];
  total: number;
  /** Con cierre normal disponible. */
  cerrables: number;
  cerrados: number;
  otros: number;
};

/**
 * Grupos por Día/Semana/Mes de fechaPlan, clave DESC; dentro de cada clave se conserva el orden del backend
 * (orden estable). Agrupa SOLO la página ya cargada (paginación server-side aparte) — nunca decide qué cerrar,
 * eso lo resuelve el backend sobre TODO el período (ver notaPaginacionGrupo más abajo).
 */
export function agruparPlanes<T extends PlanAgrupable>(planes: T[], modo: AgrupacionPlanes): GrupoPlanes<T>[] {
  const mapa = new Map<string, T[]>();
  for (const p of planes) {
    const clave = claveAgrupacion(p.fechaPlan, modo);
    const lista = mapa.get(clave);
    if (lista) lista.push(p); else mapa.set(clave, [p]);
  }
  return [...mapa.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([clave, lista]) => {
      const cerrables = lista.filter((p) => puedeCerrarNormalmente(p.estado, p.pendienteCierre, p.tarifaComercial != null)).length;
      const cerrados = lista.filter((p) => p.estado === "Cerrado").length;
      const etiqueta = resolverPeriodoPlanes(modo, clave)?.etiqueta ?? clave;
      return { clave, etiqueta, planes: lista, total: lista.length, cerrables, cerrados, otros: lista.length - cerrables - cerrados };
    });
}

/** Grupos contraídos por defecto; el deep-link abre su grupo salvo que exista un toggle explícito. */
export function grupoAbierto(
  _indice: number,
  clave: string,
  toggles: Record<string, boolean>,
  contieneFoco: boolean,
): boolean {
  return toggles[clave] ?? contieneFoco;
}

/** "semana" es femenino ("Esta semana"); "día"/"mes" son masculinos ("Este día"/"Este mes"). */
const NOMBRE_AGRUPACION: Record<AgrupacionPlanes, { articulo: string; nombre: string }> = {
  DIA: { articulo: "Este", nombre: "día" },
  SEMANA: { articulo: "Esta", nombre: "semana" },
  MES: { articulo: "Este", nombre: "mes" },
};

/**
 * Paginación server-side: un grupo (día/semana/mes) puede partirse entre páginas; solo los grupos de los bordes
 * pueden estar incompletos. Generalizado de "este día" a "este día/esta semana/este mes" según `modo` — sigue
 * siendo puramente informativo (la acción de cierre del PERÍODO COMPLETO nunca depende de esta nota ni de qué
 * página está cargada: la resuelve el backend sobre todo el rango, ver candidatos-cierre).
 */
export function notaPaginacionGrupo(indice: number, totalGrupos: number, pagina: number, totalPaginas: number, modo: AgrupacionPlanes): string | null {
  const { articulo, nombre } = NOMBRE_AGRUPACION[modo];
  const continuaAntes = indice === 0 && pagina > 1;
  const continuaDespues = indice === totalGrupos - 1 && pagina < totalPaginas;
  if (continuaAntes && continuaDespues) return `${articulo} ${nombre} puede continuar en la página anterior y en la siguiente.`;
  if (continuaAntes) return `${articulo} ${nombre} puede continuar en la página anterior.`;
  if (continuaDespues) return `${articulo} ${nombre} puede continuar en la página siguiente.`;
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

/** "Seleccionar elegibles" de un grupo: solo viajes que admiten algún cierre (SOLO la página cargada). */
export function idsSeleccionables<T extends PlanAgrupable>(planes: T[], puedeCerrarViaje: boolean): number[] {
  return planes.filter((p) => esSeleccionable(p, puedeCerrarViaje)).map((p) => p.id);
}

/** Formateador día-only (dd/mm/aaaa) — se mantiene por compatibilidad; los grupos ya traen su propia `etiqueta`. */
export const fechaVisible = (f: string) => f.slice(0, 10).split("-").reverse().join("/");

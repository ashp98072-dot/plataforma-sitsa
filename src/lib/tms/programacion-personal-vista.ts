/**
 * PROGRAMACIÓN — qué piloto(s) y auxiliares MUESTRA un viaje (funciones puras, compartidas por tarjetas, contadores y filtros).
 *
 * Viaje PROPIO:  piloto principal de RRHH (+ piloto extra de RRHH si existe) y auxiliares de RRHH.
 * Viaje TERCERIZADO: el piloto y los auxiliares EXTERNOS guardados como texto (`piloto_externo_nombre`, `auxiliares_externos`, un nombre por
 * línea). En un Tercerizado `piloto`/`auxiliares` (RRHH) vienen vacíos A PROPÓSITO (piloto_id NULL): usarlos para decidir "Sin piloto" /
 * "Sin auxiliares" era la causa de que un viaje con datos externos se viera vacío. Los externos NUNCA se convierten en empleados RRHH.
 */
export type PlanPersonalVista = {
  tipo_viaje?: string | null;
  piloto: string | null;
  pilotoExtraNombre?: string | null;
  piloto_externo_nombre?: string | null;
  auxiliares: string[];
  auxiliares_externos?: string | null;
};

export const esPlanTercerizado = (p: Pick<PlanPersonalVista, "tipo_viaje">) => (p.tipo_viaje ?? "Propio") === "Tercerizado";

const limpio = (v: string | null | undefined) => (v ?? "").trim();

/** Auxiliares externos: un nombre por línea (se conservan los saltos de línea del texto guardado; líneas vacías se ignoran). */
export function auxiliaresExternosDe(p: Pick<PlanPersonalVista, "auxiliares_externos">): string[] {
  return (p.auxiliares_externos ?? "").split(/\r?\n/).map((n) => n.trim()).filter(Boolean);
}

export type PilotosVista = { principal: string | null; extra: string | null; externo: boolean };

export function pilotosDeVista(p: PlanPersonalVista): PilotosVista {
  if (esPlanTercerizado(p)) return { principal: limpio(p.piloto_externo_nombre) || null, extra: null, externo: true };
  return { principal: limpio(p.piloto) || null, extra: limpio(p.pilotoExtraNombre) || null, externo: false };
}

export type AuxiliaresVista = { nombres: string[]; externo: boolean };

export function auxiliaresDeVista(p: PlanPersonalVista): AuxiliaresVista {
  return esPlanTercerizado(p) ? { nombres: auxiliaresExternosDe(p), externo: true } : { nombres: p.auxiliares, externo: false };
}

/** ¿Tiene piloto? (Tercerizado: el piloto externo cuenta). Alimenta "Sin piloto": contador, filtro rápido y tarjeta. */
export const tienePilotoVista = (p: PlanPersonalVista) => pilotosDeVista(p).principal != null;

/** ¿Tiene auxiliares? (Tercerizado: los externos cuentan). */
export const tieneAuxiliaresVista = (p: PlanPersonalVista) => auxiliaresDeVista(p).nombres.length > 0;

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — elegibilidad ADITIVA para aparecer en los selectores de Piloto/
 * Auxiliar de Programación: un empleado califica si (A) ya calificaba por la lógica legacy de
 * puesto/categoriaOps de RRHH (sin cambios, misma regla de siempre), O (B) tiene una habilitación operativa
 * ACTIVA para ese rol (tms_personal_habilitaciones, ver personal-habilitaciones.ts) — nunca se QUITA a
 * nadie que ya calificaba antes; la habilitación solo AGREGA.
 *
 * Extraída como función pura (antes vivía inline en plan-form.tsx) para poder probarla directamente con
 * vitest — mismo criterio que tituloEmpresa()/agruparPorFirmante() en otros módulos de este repo.
 */
export type EmpleadoOps = {
  categoriaOps?: string | null;
  puesto?: string | null;
};

export type HabilitacionOp = {
  rol: "PILOTO" | "AUXILIAR";
  estado: "HABILITADO" | "CAPACITACION";
};

export type Elegibilidad = {
  elegible: boolean;
  /** Estado de la habilitación EXPLÍCITA para este rol, si existe — aporta el badge aunque el empleado también califique por legacy (regla: "evitar duplicados; la habilitación explícita debe aportar su estado/badge"). `null` cuando no hay habilitación explícita (calificó solo por legacy, o no calificó). */
  estado: "HABILITADO" | "CAPACITACION" | null;
};

function calificaLegacy(
  categoriaOps: string | null | undefined,
  puesto: string | null | undefined,
  rol: "PILOTO" | "AUXILIAR",
): boolean {
  const cat = (categoriaOps || "").toLowerCase();
  const pue = (puesto || "").toLowerCase();
  const termino = rol === "PILOTO" ? "piloto" : "auxiliar";
  const valorExacto = rol === "PILOTO" ? "Piloto" : "Auxiliar";
  return categoriaOps === valorExacto || cat.includes(termino) || pue.includes(termino);
}

/** Elegibilidad de UN empleado para UN rol — combina legacy (RRHH) + habilitación operativa explícita. */
export function elegibilidadRol(
  empleado: EmpleadoOps,
  habilitaciones: HabilitacionOp[] | undefined,
  rol: "PILOTO" | "AUXILIAR",
): Elegibilidad {
  const legacy = calificaLegacy(empleado.categoriaOps, empleado.puesto, rol);
  const habilitacion = (habilitaciones ?? []).find((h) => h.rol === rol);
  return { elegible: legacy || Boolean(habilitacion), estado: habilitacion ? habilitacion.estado : null };
}

/**
 * Filtra una lista de empleados para un rol — SIN el fallback "si no hay match, mostrar a todos" que tenía
 * la lógica anterior: si la lista resultante queda vacía, se devuelve vacía (el selector/la UI es quien
 * decide el mensaje "no hay empleados elegibles", nunca cae a mostrar la lista completa por defecto).
 */
export function filtrarElegibles<T extends EmpleadoOps>(
  empleados: T[],
  habilitacionesPorEmpleado: Map<number, HabilitacionOp[]> | undefined,
  rol: "PILOTO" | "AUXILIAR",
  idDe: (e: T) => number,
): (T & { habilitacionEstado: "HABILITADO" | "CAPACITACION" | null })[] {
  return empleados
    .map((e) => ({ e, elegibilidad: elegibilidadRol(e, habilitacionesPorEmpleado?.get(idDe(e)), rol) }))
    .filter(({ elegibilidad }) => elegibilidad.elegible)
    .map(({ e, elegibilidad }) => ({ ...e, habilitacionEstado: elegibilidad.estado }));
}

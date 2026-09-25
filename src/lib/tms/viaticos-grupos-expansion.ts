import type { ModoAgrupacion } from "./viaticos-agrupacion";

/**
 * TMS-VIATICOS — estado de expansión de los grupos de fecha (Día/Semana/Mes) del listado general. Lógica PURA y
 * SOLO visual: es el conjunto de claves de grupos ABIERTOS (independiente por grupo, varios a la vez). Estado inicial:
 * conjunto vacío = TODOS colapsados. Nada aquí toca selección, filtros, datos ni hace requests.
 */
export type GruposAbiertos = ReadonlySet<string>;

export const GRUPOS_INICIALES: GruposAbiertos = new Set<string>();

/** Clave de expansión: incluye el modo, así cada agrupación conserva su propio estado. */
export const claveExpansion = (modo: ModoAgrupacion, claveGrupo: string) => `${modo}:${claveGrupo}`;

export const estaAbierto = (abiertos: GruposAbiertos, clave: string) => abiertos.has(clave);

/** Abre si estaba cerrado y cierra si estaba abierto (sin excepciones: ningún grupo queda forzado abierto). */
export function alternarGrupo(abiertos: GruposAbiertos, clave: string): GruposAbiertos {
  const s = new Set(abiertos);
  if (s.has(clave)) s.delete(clave);
  else s.add(clave);
  return s;
}

/** Abre todos los grupos visibles (conserva el estado de los no visibles). */
export function expandirTodos(abiertos: GruposAbiertos, clavesVisibles: string[]): GruposAbiertos {
  return new Set([...abiertos, ...clavesVisibles]);
}

/** Cierra todos los grupos. */
export function ocultarTodos(): GruposAbiertos {
  return new Set<string>();
}

/** ¿Todos los grupos visibles están abiertos? (para deshabilitar "Expandir todos"). */
export const todosAbiertos = (abiertos: GruposAbiertos, clavesVisibles: string[]) =>
  clavesVisibles.length > 0 && clavesVisibles.every((c) => abiertos.has(c));

/** ¿Hay algún grupo visible abierto? (para deshabilitar "Ocultar todos"). */
export const algunoAbierto = (abiertos: GruposAbiertos, clavesVisibles: string[]) => clavesVisibles.some((c) => abiertos.has(c));

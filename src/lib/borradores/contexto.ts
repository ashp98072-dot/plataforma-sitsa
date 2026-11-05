import { problemaAmbitoUsuarioEmpresa } from "./ambito";

/**
 * BORR-1b — contexto autenticado que el SERVIDOR entrega al cliente para usar el núcleo de borradores. Contiene solo lo
 * imprescindible: el `ownerKey` opaco (ver owner-key.ts), la empresa validada y su slug. Sin username, rol, permisos, JWT ni
 * secretos. El cliente no puede elegirlo: llega del layout RSC, que lo calcula de la sesión y de la empresa ya autorizada.
 */
export type ContextoBorradores = { ownerKey: string; empresaId: number; empresaSlug: string };

/** Valida y copia el contexto (frontera de confianza: lo que llega de props se vuelve a comprobar con las reglas del núcleo). */
export function construirContextoBorradores(datos: { ownerKey: unknown; empresaId: unknown; empresaSlug: unknown }): ContextoBorradores | null {
  const { ownerKey, empresaId, empresaSlug } = datos;
  if (problemaAmbitoUsuarioEmpresa({ ownerKey, empresaId })) return null;
  if (typeof empresaSlug !== "string" || empresaSlug.trim().length === 0 || empresaSlug.length > 200) return null;
  return { ownerKey: ownerKey as string, empresaId: empresaId as number, empresaSlug };
}

export function mismoContextoBorradores(a: ContextoBorradores | null, b: ContextoBorradores | null): boolean {
  if (a === b) return true;
  return a !== null && b !== null && a.ownerKey === b.ownerKey && a.empresaId === b.empresaId && a.empresaSlug === b.empresaSlug;
}

/**
 * Aprobación DELEGADA de una identidad física: un administrador global registra la aprobación de una empresa en cuyo módulo Flota no opera
 * (p. ej. la propietaria de una ficha compartida) sin habilitar ese módulo. Interruptor `FLOTA_IDENTIDAD_APROBACION_DELEGADA=1` (apagado por defecto).
 * Reglas: solo `Admin`; solo empresas a las que el usuario TIENE acceso (misma lista que usa requireTenant); la evidencia sigue siendo obligatoria y
 * queda marcada como delegada en la aprobación y en la auditoría. No evita ninguna otra comprobación (chasis, operaciones abiertas, empresas requeridas, administrador vigente).
 */
export const aprobacionDelegadaHabilitada = (env: NodeJS.ProcessEnv = process.env) => env.FLOTA_IDENTIDAD_APROBACION_DELEGADA === "1";

export type EntradaDelegacion = { habilitada: boolean; rol: string; empresaActivaId: number; empresaAprobadoraId?: number; empresasPermitidasIds: number[] };
export type ResultadoDelegacion = { ok: true; delegada: boolean; empresaAprobadoraId: number } | { ok: false; status: number; error: string };

export function validarDelegacion(e: EntradaDelegacion): ResultadoDelegacion {
  const objetivo = e.empresaAprobadoraId ?? e.empresaActivaId;
  if (objetivo === e.empresaActivaId) return { ok: true, delegada: false, empresaAprobadoraId: e.empresaActivaId };
  if (!e.habilitada) return { ok: false, status: 403, error: "La aprobación en nombre de otra empresa no está habilitada." };
  if (e.rol !== "Admin") return { ok: false, status: 403, error: "Solo un administrador puede aprobar en nombre de otra empresa." };
  if (!e.empresasPermitidasIds.includes(objetivo)) return { ok: false, status: 403, error: "Sin acceso a la empresa en cuyo nombre se aprueba." };
  return { ok: true, delegada: true, empresaAprobadoraId: objetivo };
}

/** Texto que queda guardado como evidencia de la aprobación (máx. 1000 caracteres, límite de la columna). */
export const evidenciaDelegada = (evidencia: string, empresaOrigenId: number) => `[Aprobación delegada desde la empresa ${empresaOrigenId}] ${evidencia}`.slice(0, 1000);

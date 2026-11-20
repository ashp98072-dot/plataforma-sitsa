import { createHash } from "node:crypto";
import type { AvisoLote } from "@/lib/tms/programacion-lote";

/**
 * ACEPTACIÓN EXPLÍCITA DE AVISOS (copia fiel al origen) — solo servidor (usa node:crypto; no importar desde el cliente).
 *
 * La vista previa devuelve, junto a los avisos, una HUELLA calculada por el servidor sobre los datos ESTRUCTURADOS de cada aviso (tipo, recurso afectado,
 * viaje que lo ocupa y filas relacionadas) más el contexto (empresa, fecha origen y destino). El texto de presentación (`mensaje`) NO entra en la huella.
 * Al confirmar, el servidor recalcula la huella con los avisos vigentes bajo el candado y exige que coincida con la aceptada: si faltan o cambió cualquier
 * dato material (otro recurso, otro viaje que lo ocupa, otras filas relacionadas, otra empresa o fechas), rechaza sin escribir nada.
 */
export const MSG_AVISOS_SIN_ACEPTAR =
  "Hay avisos de la copia sin aceptar o que cambiaron desde la vista previa. Revisa los avisos y vuelve a validar antes de confirmar. No se creó ningún viaje.";

/** Forma canónica y ordenada de un aviso: solo datos estructurados, nunca el texto de presentación. */
function canonico(a: AvisoLote) {
  return [a.tipo, a.recurso.tipo, String(a.recurso.id), [...(a.filas ?? [])].sort((x, y) => x - y), a.ocupadoPor?.planId ?? null] as const;
}

/** "" si no hay ningún aviso (no hay nada que aceptar); si hay, el SHA-256 (hex, 64 caracteres) de la forma canónica del conjunto. */
export function huellaAvisosCopia(
  ctx: { empresaId: number; fechaOrigen: string; fechaDestino: string },
  filas: readonly { fila: number; avisos?: readonly AvisoLote[] }[],
): string {
  const porFila = filas
    .filter((f) => (f.avisos?.length ?? 0) > 0)
    .map((f) => [f.fila, f.avisos!.map(canonico).map((c) => JSON.stringify(c)).sort()] as const)
    .sort((a, b) => a[0] - b[0]);
  if (!porFila.length) return "";
  return createHash("sha256").update(JSON.stringify({ v: 1, e: ctx.empresaId, o: ctx.fechaOrigen, d: ctx.fechaDestino, a: porFila })).digest("hex");
}

export const HUELLA_RE = /^[0-9a-f]{64}$/;

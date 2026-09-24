/**
 * A2.2 — traslado de la ventana temporal al COPIAR programación. Puro (fechas de calendario `YYYY-MM-DD`, sin zona
 * horaria). El regreso estimado de la copia conserva la HORA y el DESFASE EN DÍAS respecto a `fecha_plan` del origen:
 * origen 24/09 22:00 -> 25/09 02:00 (+1) copiado al 30/09 => regreso 01/10 02:00; +2 días => 02/oct al copiar al 30/09.
 */
const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 86_400_000;

const aMs = (fecha: string): number | null => {
  const m = FECHA_RE.exec(fecha);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? ms : null;
};

/** `fecha` + `dias` (puede cruzar mes o año). */
export function sumarDiasFecha(fecha: string, dias: number): string {
  const ms = aMs(fecha);
  if (ms == null) throw new Error("Fecha inválida.");
  return new Date(ms + dias * DIA_MS).toISOString().slice(0, 10);
}

export type TrasladoRegreso = { offsetDias: number; hora: string };

/**
 * Desfase (días de calendario) y hora del regreso del ORIGEN respecto a su `fecha_plan`. `null` si no hay regreso
 * o es incoherente (fecha/hora inválidas o anterior al día de salida): la copia queda sin regreso (reserva diaria).
 * `regresoOrigen`: "YYYY-MM-DD HH:mm[:ss]" o con "T".
 */
export function calcularTrasladoRegreso(fechaOrigen: string, regresoOrigen: string | null | undefined): TrasladoRegreso | null {
  if (!regresoOrigen) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/.exec(regresoOrigen.trim());
  const desde = aMs(fechaOrigen);
  const hasta = m ? aMs(m[1]) : null;
  if (!m || desde == null || hasta == null || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  const offsetDias = Math.round((hasta - desde) / DIA_MS);
  return offsetDias < 0 ? null : { offsetDias, hora: `${m[2]}:${m[3]}` };
}

/** Regreso de la copia ("YYYY-MM-DDTHH:mm") para la fecha destino, o `null` si el origen no tenía regreso. */
export function regresoTrasladado(fechaDestino: string, traslado: TrasladoRegreso | null | undefined): string | null {
  return traslado ? `${sumarDiasFecha(fechaDestino, traslado.offsetDias)}T${traslado.hora}` : null;
}

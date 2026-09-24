import { fechaCalendario, periodoDe, type ModoAgrupacion } from "./viaticos-agrupacion";

/**
 * TMS-VIATICOS-REQUERIMIENTO-FORMAL — periodo cubierto por un requerimiento (Día / Semana lunes–domingo / Mes).
 * Se calcula UNA vez al guardar y se persiste (periodo_tipo/desde/hasta); PDF y Excel solo lo formatean, nunca lo recalculan.
 * Todo son fechas de calendario `YYYY-MM-DD` (sin zona horaria).
 */
export const PERIODOS_REQUERIMIENTO = ["DIA", "SEMANA", "MES"] as const;
export type PeriodoTipo = ModoAgrupacion;

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** `YYYY-MM-DD` → `DD/MM/YYYY` (cualquier otro valor se devuelve tal cual; vacío → "—"). */
export function fechaDMA(v: unknown): string {
  const f = fechaCalendario(String(v ?? ""));
  return f ? f.split("-").reverse().join("/") : String(v ?? "").trim() || "—";
}

/** Mensaje de error si alguna fecha de viaje cae fuera del periodo declarado (null = todas coherentes). */
export function fechaFueraDePeriodo(desde: string, hasta: string, tipo: PeriodoTipo, fechas: string[]): string | null {
  const fuera = [...new Set(fechas)].filter(f => f < desde || f > hasta).sort();
  if (!fuera.length) return null;
  const etiqueta = etiquetaPeriodoRequerimiento(tipo, desde, hasta);
  return `Todas las fechas de viaje deben pertenecer al periodo (${etiqueta}). Fuera del periodo: ${fuera.map(fechaDMA).join(", ")}.`;
}

/** Periodo (tipo, desde, hasta) que contiene la fecha de referencia. */
export function calcularPeriodoRequerimiento(tipo: PeriodoTipo, referencia: string): { periodoTipo: PeriodoTipo; periodoDesde: string; periodoHasta: string } {
  const f = fechaCalendario(referencia);
  if (!f) throw new Error("La fecha de referencia del periodo no es válida.");
  const p = periodoDe(f, tipo);
  return { periodoTipo: tipo, periodoDesde: p.desde, periodoHasta: p.hasta };
}

/** "Día 21/09/2026" · "Semana 21/09/2026 – 27/09/2026" · "Mes septiembre 2026"; sin snapshot → "—". */
export function etiquetaPeriodoRequerimiento(tipo: unknown, desde: unknown, hasta: unknown): string {
  const d = fechaCalendario(String(desde ?? ""));
  const h = fechaCalendario(String(hasta ?? ""));
  if (!d || !h) return "—";
  if (tipo === "DIA") return `Día ${fechaDMA(d)}`;
  if (tipo === "SEMANA") return `Semana ${fechaDMA(d)} – ${fechaDMA(h)}`;
  if (tipo === "MES") return `Mes ${MESES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  return "—";
}

/**
 * TMS-VIATICOS-AGRUPACION-1 (PR 1) — lógica PURA (sin BD, sin React) para AGRUPAR el listado de viáticos por
 * Día / Semana / Mes y para la selección por grupo. Se agrupa DESPUÉS de filtrar y solo en el cliente.
 *
 * Todas las fechas son de CALENDARIO (`YYYY-MM-DD`, la `fechaPlan` del viaje): nunca se reinterpretan con la zona
 * horaria del navegador. La aritmética de días se hace en UTC sobre fechas ya de calendario (no hay conversión de zona).
 */
export type ModoAgrupacion = "DIA" | "SEMANA" | "MES";
export const MODOS_AGRUPACION: { modo: ModoAgrupacion; etiqueta: string }[] = [
  { modo: "DIA", etiqueta: "Día" },
  { modo: "SEMANA", etiqueta: "Semana" },
  { modo: "MES", etiqueta: "Mes" },
];

export const ESTADOS_VIATICO = ["PROGRAMADO", "AUTORIZADO", "RECHAZADO", "ENTREGADO", "LIQUIDADO"] as const;
export type EstadoViaticoAgrupable = (typeof ESTADOS_VIATICO)[number];

export type ViaticoAgrupable = { id: number; fechaPlan: string; estado: string; montoAsignado: number };

export type ConteosEstado = Record<EstadoViaticoAgrupable, number>;

export type GrupoViaticos<T extends ViaticoAgrupable> = {
  /** DIA: YYYY-MM-DD · SEMANA: YYYY-MM-DD del LUNES · MES: YYYY-MM · sin fecha: "SIN-FECHA". */
  clave: string;
  /** Primer y último día (inclusive) del período; null en el grupo sin fecha. */
  desde: string | null;
  hasta: string | null;
  etiqueta: string;
  items: T[];
  total: number;
  conteos: ConteosEstado;
  /** SUMA de monto_asignado de todos los viáticos EXCEPTO los RECHAZADOS (los rechazados se cuentan aparte, no se ocultan). */
  montoNoRechazado: number;
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})/;

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const DIA_MS = 86_400_000;

/** Fecha de calendario válida (`YYYY-MM-DD`) o null. */
export function fechaCalendario(valor: string): string | null {
  const m = FECHA_RE.exec(String(valor ?? ""));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Lunes (YYYY-MM-DD) de la semana lunes–domingo que contiene la fecha. */
export function lunesDeSemana(fecha: string): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dow = new Date(ms).getUTCDay(); // 0 = domingo
  return iso(ms - ((dow + 6) % 7) * DIA_MS);
}

const dmy = (f: string) => f.split("-").reverse().join("/");
const partes = (f: string) => { const [y, m, d] = f.split("-").map(Number); return { y, m, d }; };

/** "Semana 21–27 septiembre 2026", "Semana 28 sep – 4 oct 2026", "Semana 29 dic 2026 – 4 ene 2027". */
export function etiquetaSemana(lunes: string, domingo: string): string {
  const a = partes(lunes);
  const b = partes(domingo);
  if (a.y !== b.y) return `Semana ${a.d} ${MESES_CORTOS[a.m - 1]} ${a.y} – ${b.d} ${MESES_CORTOS[b.m - 1]} ${b.y}`;
  if (a.m !== b.m) return `Semana ${a.d} ${MESES_CORTOS[a.m - 1]} – ${b.d} ${MESES_CORTOS[b.m - 1]} ${b.y}`;
  return `Semana ${a.d}–${b.d} ${MESES[a.m - 1]} ${a.y}`;
}

export function etiquetaMes(clave: string): string {
  const [y, m] = clave.split("-").map(Number);
  const nombre = MESES[m - 1];
  return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} ${y}`;
}

/** Período (clave, límites y etiqueta) al que pertenece una fecha de calendario según el modo. */
export function periodoDe(fecha: string, modo: ModoAgrupacion): { clave: string; desde: string; hasta: string; etiqueta: string } {
  if (modo === "DIA") return { clave: fecha, desde: fecha, hasta: fecha, etiqueta: dmy(fecha) };
  if (modo === "SEMANA") {
    const lunes = lunesDeSemana(fecha);
    const [y, m, d] = lunes.split("-").map(Number);
    const domingo = iso(Date.UTC(y, m - 1, d) + 6 * DIA_MS);
    return { clave: lunes, desde: lunes, hasta: domingo, etiqueta: etiquetaSemana(lunes, domingo) };
  }
  const { y, m } = partes(fecha);
  const clave = `${y}-${pad(m)}`;
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { clave, desde: `${clave}-01`, hasta: `${clave}-${pad(ultimo)}`, etiqueta: etiquetaMes(clave) };
}

const conteosVacios = (): ConteosEstado => ({ PROGRAMADO: 0, AUTORIZADO: 0, RECHAZADO: 0, ENTREGADO: 0, LIQUIDADO: 0 });

/**
 * Agrupa (ya filtrados) por período, del MÁS RECIENTE al más antiguo. Dentro de cada grupo se conserva el orden de
 * entrada. Un viático sin fecha válida (no debería existir) va a un grupo "Sin fecha" al final; nunca se pierde.
 */
export function agruparViaticos<T extends ViaticoAgrupable>(items: T[], modo: ModoAgrupacion): GrupoViaticos<T>[] {
  const mapa = new Map<string, GrupoViaticos<T>>();
  for (const it of items) {
    const f = fechaCalendario(it.fechaPlan);
    const p = f ? periodoDe(f, modo) : { clave: "SIN-FECHA", desde: null, hasta: null, etiqueta: "Sin fecha" };
    let g = mapa.get(p.clave);
    if (!g) {
      g = { clave: p.clave, desde: p.desde, hasta: p.hasta, etiqueta: p.etiqueta, items: [], total: 0, conteos: conteosVacios(), montoNoRechazado: 0 };
      mapa.set(p.clave, g);
    }
    g.items.push(it);
    g.total += 1;
    if ((ESTADOS_VIATICO as readonly string[]).includes(it.estado)) g.conteos[it.estado as EstadoViaticoAgrupable] += 1;
    if (it.estado !== "RECHAZADO") g.montoNoRechazado = Math.round((g.montoNoRechazado + Number(it.montoAsignado || 0)) * 100) / 100;
  }
  return [...mapa.values()].sort((a, b) => {
    if (a.clave === "SIN-FECHA") return 1;
    if (b.clave === "SIN-FECHA") return -1;
    return a.clave < b.clave ? 1 : a.clave > b.clave ? -1 : 0;
  });
}

// ---------------------------------------------------------------- selección POR GRUPO
// La selección es UN conjunto de ids, pero cada control opera solo sobre los ids de SU grupo: nunca mezcla grupos.

export const idsDeGrupo = (g: { items: { id: number }[] }): number[] => g.items.map((x) => x.id);

export function seleccionadosDelGrupo(sel: ReadonlySet<number>, g: { items: { id: number }[] }): number[] {
  return g.items.filter((x) => sel.has(x.id)).map((x) => x.id);
}

export function alternarEnSeleccion(sel: ReadonlySet<number>, id: number): Set<number> {
  const n = new Set(sel);
  if (n.has(id)) n.delete(id); else n.add(id);
  return n;
}

/** Marca todos los viáticos del grupo (los demás grupos no cambian). */
export function seleccionarTodosDelGrupo(sel: ReadonlySet<number>, g: { items: { id: number }[] }): Set<number> {
  return new Set([...sel, ...idsDeGrupo(g)]);
}

/** Quita solo los ids de este grupo (los seleccionados de otros grupos se conservan). */
export function limpiarSeleccionDelGrupo(sel: ReadonlySet<number>, g: { items: { id: number }[] }): Set<number> {
  const propios = new Set(idsDeGrupo(g));
  return new Set([...sel].filter((id) => !propios.has(id)));
}

/** ¿Están todos los viáticos del grupo seleccionados? (checkbox del encabezado del grupo) */
export const grupoCompletoSeleccionado = (sel: ReadonlySet<number>, g: { items: { id: number }[] }): boolean =>
  g.items.length > 0 && g.items.every((x) => sel.has(x.id));

/**
 * Ids que "Autorizar seleccionados" de ESTE grupo enviará al flujo actual: EXACTAMENTE los seleccionados del grupo
 * (ni de otros grupos, ni "todo lo visible"). El flujo de autorización (POST individual por viático, parcial) no cambia.
 */
export const idsAAutorizarDelGrupo = seleccionadosDelGrupo;

/** Texto del encabezado, p. ej. "35 viáticos · 30 pendientes · Q2,450.00". */
export function resumenGrupo(g: Pick<GrupoViaticos<ViaticoAgrupable>, "total" | "conteos" | "montoNoRechazado">, formatoMoneda: (n: number) => string): string {
  return [
    `${g.total} viático${g.total === 1 ? "" : "s"}`,
    g.conteos.PROGRAMADO ? `${g.conteos.PROGRAMADO} pendiente${g.conteos.PROGRAMADO === 1 ? "" : "s"}` : null,
    formatoMoneda(g.montoNoRechazado),
  ].filter(Boolean).join(" · ");
}

import { fechaCalendario } from "./viaticos-agrupacion";

/**
 * VIATICOS-COMPROBANTE-PERIODO — lógica PURA (sin BD) para resolver el rango de fechas de un comprobante de
 * autorización de viáticos por Día/Semana/Mes. El criterio temporal SIEMPRE es la fecha en que se autorizó cada
 * viático (`tms_viaticos.autorizado_en`), nunca la fecha del viaje ni el estado actual — ver
 * src/lib/tms/viaticos-comprobante-pdf.ts y la ruta del comprobante.
 *
 * Rango SIEMPRE semiabierto: `autorizado_en >= inicio AND autorizado_en < finExclusivo` (nunca `<= 23:59:59`,
 * que puede perder registros con fracciones de segundo o `NOW()` exacto). Fechas de PARED Guatemala — nunca
 * conversiones UTC inventadas: la aritmética de días se hace en UTC pero SOLO sobre fechas de calendario ya
 * resueltas (mismo criterio que viaticos-agrupacion.ts), no sobre instantes con zona horaria real.
 */
export type TipoPeriodoComprobante = "DIA" | "SEMANA" | "MES";

export type PeriodoComprobante = {
  /** "YYYY-MM-DD HH:mm:ss", límite inferior INCLUSIVO. */
  inicio: string;
  /** "YYYY-MM-DD HH:mm:ss", límite superior EXCLUSIVO. */
  finExclusivo: string;
  /** Texto humano para el encabezado del PDF (sin el prefijo "Período: ", eso lo agrega el PDF). */
  etiqueta: string;
  /** Nombre de archivo sugerido, sin ruta (p. ej. "viaticos-autorizados-2026-09-30.pdf"). */
  archivo: string;
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const DIA_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const partes = (fecha: string) => {
  const [y, m, d] = fecha.split("-").map(Number);
  return { y, m, d };
};

/** "30 de septiembre de 2026". */
function fechaLarga(y: number, m: number, d: number): string {
  return `${d} de ${MESES[m - 1]} de ${y}`;
}
/** "28 de septiembre" (sin año — solo para el extremo inicial de una semana dentro del mismo año). */
function fechaCorta(m: number, d: number): string {
  return `${d} de ${MESES[m - 1]}`;
}

function resolverDia(valor: string): PeriodoComprobante | null {
  const fecha = fechaCalendario(String(valor ?? "").trim());
  if (!fecha) return null;
  const { y, m, d } = partes(fecha);
  const finExclusivo = iso(Date.UTC(y, m - 1, d) + DIA_MS);
  return {
    inicio: `${fecha} 00:00:00`,
    finExclusivo: `${finExclusivo} 00:00:00`,
    etiqueta: fechaLarga(y, m, d),
    archivo: `viaticos-autorizados-${fecha}.pdf`,
  };
}

/**
 * Semana ISO 8601 (lunes-domingo) real de una fecha de calendario: el jueves de esa semana determina el año ISO
 * (regla estándar — evita que el 1 de enero se cuente como semana 1 del año equivocado, o que el 31 de diciembre
 * quede en la semana 1 del año siguiente).
 */
function semanaIsoDe(fecha: string): { anio: number; semana: number } {
  const { y, m, d } = partes(fecha);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // 1=lunes..7=domingo
  date.setUTCDate(date.getUTCDate() + (4 - dow)); // mover al jueves de la MISMA semana
  const anioIso = date.getUTCFullYear();
  const inicioAnioIso = Date.UTC(anioIso, 0, 1);
  const semana = Math.ceil((date.getTime() - inicioAnioIso) / DIA_MS / 7 + 0.5);
  return { anio: anioIso, semana };
}

const SEMANA_RE = /^(\d{4})-W(\d{2})$/;

function resolverSemana(valor: string): PeriodoComprobante | null {
  const m = SEMANA_RE.exec(String(valor ?? "").trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const semana = Number(m[2]);
  if (semana < 1 || semana > 53) return null;

  // Lunes de la semana 1 ISO = lunes de la semana que contiene el 4 de enero (regla estándar).
  const jan4Ms = Date.UTC(anio, 0, 4);
  const dowJan4 = new Date(jan4Ms).getUTCDay() || 7;
  const mondayWeek1Ms = jan4Ms - (dowJan4 - 1) * DIA_MS;
  const mondayMs = mondayWeek1Ms + (semana - 1) * 7 * DIA_MS;
  const inicioFecha = iso(mondayMs);

  // Validación de ida y vuelta: rechaza semanas que no existen realmente en ese año ISO (p. ej. semana 53 en un
  // año que solo tiene 52) en vez de aceptar silenciosamente un rango que "se corre" a otra semana.
  const real = semanaIsoDe(inicioFecha);
  if (real.anio !== anio || real.semana !== semana) return null;

  const finExclusivaFecha = iso(mondayMs + 7 * DIA_MS);
  const domingoFecha = iso(mondayMs + 6 * DIA_MS);
  const inicio = partes(inicioFecha);
  const fin = partes(domingoFecha);
  const etiqueta = inicio.y === fin.y
    ? `${fechaCorta(inicio.m, inicio.d)} al ${fechaLarga(fin.y, fin.m, fin.d)}`
    : `${fechaLarga(inicio.y, inicio.m, inicio.d)} al ${fechaLarga(fin.y, fin.m, fin.d)}`;

  return {
    inicio: `${inicioFecha} 00:00:00`,
    finExclusivo: `${finExclusivaFecha} 00:00:00`,
    etiqueta,
    archivo: `viaticos-autorizados-${anio}-W${pad(semana)}.pdf`,
  };
}

const MES_RE = /^(\d{4})-(\d{2})$/;

function resolverMes(valor: string): PeriodoComprobante | null {
  const m = MES_RE.exec(String(valor ?? "").trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  const inicioFecha = `${m[1]}-${m[2]}-01`;
  // Date.UTC con el mes 1-based tal cual (en vez de mes-1) ya apunta al PRIMER día del mes SIGUIENTE en el
  // índice 0-based real de JS — para diciembre (12) esto pasa naturalmente a enero del año siguiente.
  const finExclusivaFecha = iso(Date.UTC(anio, mes, 1));
  return {
    inicio: `${inicioFecha} 00:00:00`,
    finExclusivo: `${finExclusivaFecha} 00:00:00`,
    etiqueta: `${MESES[mes - 1]} de ${anio}`,
    archivo: `viaticos-autorizados-${m[1]}-${m[2]}.pdf`,
  };
}

/** `null` si `tipo`/`valor` no son válidos — el caller (route.ts) decide el 400. */
export function resolverPeriodoComprobante(tipo: string, valor: string): PeriodoComprobante | null {
  if (tipo === "DIA") return resolverDia(valor);
  if (tipo === "SEMANA") return resolverSemana(valor);
  if (tipo === "MES") return resolverMes(valor);
  return null;
}

/**
 * Valor por defecto del selector de período (panel de UI) al elegir un tipo, a partir de "hoy" en fecha de
 * pared Guatemala (`hoyLocal()` de src/lib/rrhh/dates.ts — el caller se la pasa, este módulo no toca `Date.now()`
 * directamente para seguir siendo puro/testeable). DÍA reutiliza la misma fecha tal cual; SEMANA/MES derivan su
 * respectivo valor ("YYYY-Www"/"YYYY-MM") de esa fecha con la MISMA semana ISO que usa resolverSemana().
 */
export function valorPeriodoHoy(tipo: TipoPeriodoComprobante, fechaHoy: string): string {
  const fecha = fechaCalendario(String(fechaHoy ?? "").trim());
  if (!fecha) return "";
  if (tipo === "DIA") return fecha;
  if (tipo === "MES") return fecha.slice(0, 7);
  const { anio, semana } = semanaIsoDe(fecha);
  return `${anio}-W${pad(semana)}`;
}

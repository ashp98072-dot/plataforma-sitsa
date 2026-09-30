/**
 * PLANES-CIERRE-PERIODO — lógica PURA (sin BD) para resolver un período Día/Semana/Mes de "Planes / Viajes"
 * (agrupación visual y cierre masivo por período). Implementación DEDICADA y ESPECÍFICA de Planes, deliberadamente
 * SEPARADA de src/lib/tms/viaticos-comprobante-periodo.ts (comprobante de autorización de viáticos, recién
 * mergeado) — no se toca ni se refactoriza ese módulo, para no correr ningún riesgo sobre él.
 *
 * Diferencia clave con el helper de viáticos: `tms_planes_viaje.fecha_plan` es una columna DATE (no DATETIME), y
 * el filtrado de fecha ya existente en reportes-viajes.ts (`construirCondiciones`) usa límites INCLUSIVOS
 * (`fecha_plan >= ? AND fecha_plan <= ?`), no el rango semiabierto con "finExclusivo" que necesita un DATETIME.
 * Por eso aquí `desde`/`hasta` son ambos INCLUSIVOS (el mismo día cuenta en ambos extremos), nunca un
 * "finExclusivo".
 */
export type AgrupacionPlanes = "DIA" | "SEMANA" | "MES";

export type PeriodoPlanes = {
  /** "2026-09-30" | "2026-W40" | "2026-09" — mismo formato que el `valor` de entrada. */
  clave: string;
  /** Texto humano para encabezados/modales: "30/09/2026" | "Semana 40 · 28/09/2026 al 04/10/2026" | "Septiembre 2026". */
  etiqueta: string;
  /** "YYYY-MM-DD", límite inferior INCLUSIVO. */
  desde: string;
  /** "YYYY-MM-DD", límite superior INCLUSIVO. */
  hasta: string;
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
const DIA_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

const FECHA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Valida que sea una fecha de calendario REAL (rechaza 2026-02-30, etc.) — propia, no importada de otro módulo. */
function fechaValida(valor: string): { y: number; m: number; d: number } | null {
  const m = FECHA_RE.exec(String(valor ?? "").trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

const fechaIso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const fechaDdMmYyyy = (y: number, m: number, d: number) => `${pad(d)}/${pad(m)}/${y}`;

function resolverDia(valor: string): PeriodoPlanes | null {
  const f = fechaValida(valor);
  if (!f) return null;
  const clave = fechaIso(f.y, f.m, f.d);
  return { clave, etiqueta: fechaDdMmYyyy(f.y, f.m, f.d), desde: clave, hasta: clave };
}

/**
 * Semana ISO 8601 (lunes-domingo) de una fecha de calendario: el jueves de esa semana determina el año ISO
 * (regla estándar). Implementación propia — misma familia de algoritmo que ya existe en el repo para
 * viáticos/agrupación, pero escrita de forma independiente para no acoplar Planes a esos módulos.
 */
function semanaIsoDe(y: number, m: number, d: number): { anio: number; semana: number } {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay() || 7; // 1=lunes..7=domingo
  date.setUTCDate(date.getUTCDate() + (4 - dow)); // mover al jueves de la MISMA semana
  const anioIso = date.getUTCFullYear();
  const inicioAnioIso = Date.UTC(anioIso, 0, 1);
  const semana = Math.ceil((date.getTime() - inicioAnioIso) / DIA_MS / 7 + 0.5);
  return { anio: anioIso, semana };
}

const SEMANA_RE = /^(\d{4})-W(\d{2})$/;

function resolverSemana(valor: string): PeriodoPlanes | null {
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
  const lunes = new Date(mondayMs);
  const ly = lunes.getUTCFullYear(), lm = lunes.getUTCMonth() + 1, ld = lunes.getUTCDate();

  // Validación de ida y vuelta: rechaza semanas que no existen realmente en ese año ISO (p. ej. semana 53 en un
  // año que solo tiene 52) en vez de aceptar silenciosamente un rango que "se corre" a otra semana.
  const real = semanaIsoDe(ly, lm, ld);
  if (real.anio !== anio || real.semana !== semana) return null;

  const domingoMs = mondayMs + 6 * DIA_MS;
  const domingo = new Date(domingoMs);
  const dy = domingo.getUTCFullYear(), dm = domingo.getUTCMonth() + 1, dd = domingo.getUTCDate();

  return {
    clave: `${m[1]}-W${m[2]}`,
    etiqueta: `Semana ${semana} · ${fechaDdMmYyyy(ly, lm, ld)} al ${fechaDdMmYyyy(dy, dm, dd)}`,
    desde: fechaIso(ly, lm, ld),
    hasta: fechaIso(dy, dm, dd),
  };
}

function ultimoDiaDelMes(y: number, m: number): number {
  // Día 0 del mes SIGUIENTE (índice 0-based) = último día del mes actual.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MES_RE = /^(\d{4})-(\d{2})$/;

function resolverMes(valor: string): PeriodoPlanes | null {
  const m = MES_RE.exec(String(valor ?? "").trim());
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  const ultimo = ultimoDiaDelMes(anio, mes);
  return {
    clave: `${m[1]}-${m[2]}`,
    etiqueta: `${MESES[mes - 1]} ${anio}`,
    desde: `${m[1]}-${m[2]}-01`,
    hasta: `${m[1]}-${m[2]}-${pad(ultimo)}`,
  };
}

/** `null` si `tipo`/`valor` no son válidos — el caller (route.ts) decide el 400. */
export function resolverPeriodoPlanes(tipo: string, valor: string): PeriodoPlanes | null {
  if (tipo === "DIA") return resolverDia(valor);
  if (tipo === "SEMANA") return resolverSemana(valor);
  if (tipo === "MES") return resolverMes(valor);
  return null;
}

/**
 * A qué grupo (clave) pertenece un `fechaPlan` (ya "YYYY-MM-DD" o con hora/offset — se recorta a los primeros 10
 * caracteres, mismo criterio que agruparPorFecha() usaba hasta ahora) bajo el tipo de agrupación pedido. Usado
 * por planes-agrupacion.ts para particionar client-side la página YA CARGADA (nunca decide qué cerrar — eso lo
 * resuelve el backend con obtenerCandidatosCierre, sobre TODO el período, no solo la página visible).
 */
export function claveAgrupacion(fechaPlan: string, tipo: AgrupacionPlanes): string {
  const fecha = String(fechaPlan ?? "").slice(0, 10);
  if (tipo === "DIA") return fecha;
  if (tipo === "MES") return fecha.slice(0, 7);
  const f = fechaValida(fecha);
  if (!f) return fecha; // defensivo: fecha ya inválida (no debería ocurrir con datos reales de la BD)
  const { anio, semana } = semanaIsoDe(f.y, f.m, f.d);
  return `${anio}-W${pad(semana)}`;
}

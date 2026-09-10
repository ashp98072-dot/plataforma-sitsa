/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — utilidad PURA (sin acceso a DB, apta
 * para cliente y servidor) que traduce un filtro "Mes + Año" al rango de
 * fechas [primer día, último día] en `YYYY-MM-DD`.
 *
 * Los reportes de Gastos operativos y Solicitudes de fondo YA aceptan
 * `fechaDesde`/`fechaHasta` (y, en fondos, `fechaSolicitudDesde/Hasta`):
 * el filtro mensual solo mapea Mes/Año a ese rango — no se agrega ningún
 * filtro nuevo ni consulta nueva en el backend.
 */
export function rangoDelMes(anio: number, mes: number): { desde: string; hasta: string } {
  const a = Math.trunc(Number(anio));
  const m = Math.trunc(Number(mes));
  if (!Number.isFinite(a) || a < 1900 || a > 9999 || m < 1 || m > 12) {
    throw new Error(`Mes/año inválido: ${anio}-${mes}`);
  }
  const mm = String(m).padStart(2, "0");
  // `Date.UTC(a, m, 0)` = último día del mes `m` (día 0 del mes siguiente),
  // en UTC para que no lo corra la zona horaria local.
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { desde: `${a}-${mm}-01`, hasta: `${a}-${mm}-${String(ultimoDia).padStart(2, "0")}` };
}

/**
 * REPORTES-MENSUALES-CONSOLIDADOS-1 — ¿el rango [desde, hasta] es
 * EXACTAMENTE un mes calendario completo? (`2026-09-01` a `2026-09-30`).
 * El PDF mensual consolidado de solicitudes de fondo lo exige: nunca se
 * infiere el mes desde una sola fecha ni se acepta un rango parcial o que
 * cruce meses. Devuelve `{ anio, mes }` si es válido, o `null` si no.
 */
export function mesCompletoDeRango(
  desde: string | undefined | null,
  hasta: string | undefined | null,
): { anio: number; mes: number } | null {
  if (!desde || !hasta) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(desde);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  let esperado: { desde: string; hasta: string };
  try {
    esperado = rangoDelMes(anio, mes);
  } catch {
    return null;
  }
  return desde === esperado.desde && hasta === esperado.hasta ? { anio, mes } : null;
}

/** Nombre visible del mes (1-12) en español, para títulos de reporte. */
export const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

export function etiquetaMes(anio: number, mes: number): string {
  const m = Math.trunc(Number(mes));
  const nombre = m >= 1 && m <= 12 ? MESES_ES[m - 1] : `Mes ${m}`;
  return `${nombre} ${Math.trunc(Number(anio))}`;
}

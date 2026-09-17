export class FechaInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FechaInvalidaError";
  }
}

/** Zona horaria oficial del negocio (sin DST). */
export const TZ_GUATEMALA = "America/Guatemala";

type PartesFechaHora = {
  y: string;
  m: string;
  d: string;
  hh: string;
  mm: string;
  ss: string;
};

function partesEnZona(
  date: Date,
  timeZone: string = TZ_GUATEMALA,
): PartesFechaHora {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    y: get("year"),
    m: get("month"),
    d: get("day"),
    hh: get("hour"),
    mm: get("minute"),
    ss: get("second"),
  };
}

/** Acepta DD/MM/AAAA o YYYY-MM-DD → ISO YYYY-MM-DD */
export function formatearFecha(entrada: string): string {
  if (!entrada || !entrada.trim()) {
    throw new FechaInvalidaError("La fecha no puede estar vacía.");
  }
  const texto = entrada.trim().replace(/[-.\s]/g, "/");
  const partes = texto.split("/").filter(Boolean);
  if (partes.length !== 3) {
    throw new FechaInvalidaError(`Fecha inválida: ${entrada}`);
  }
  let anio: string;
  let mes: string;
  let dia: string;
  if (partes[0].length === 4) [anio, mes, dia] = partes;
  else [dia, mes, anio] = partes;
  if (anio.length === 2) anio = (Number(anio) <= 79 ? "20" : "19") + anio;
  const diaI = Number(dia);
  const mesI = Number(mes);
  const anioI = Number(anio);
  const fecha = new Date(anioI, mesI - 1, diaI);
  if (
    fecha.getFullYear() !== anioI ||
    fecha.getMonth() !== mesI - 1 ||
    fecha.getDate() !== diaI
  ) {
    throw new FechaInvalidaError(`Fecha inválida: ${entrada}`);
  }
  return `${String(anioI).padStart(4, "0")}-${String(mesI).padStart(2, "0")}-${String(diaI).padStart(2, "0")}`;
}

export function formatearFechaVisible(
  fechaIso: string | null | undefined,
): string {
  if (!fechaIso) return "";
  const parte = String(fechaIso).slice(0, 10);
  const [anio, mes, dia] = parte.split("-");
  if (!anio || !mes || !dia) return String(fechaIso);
  return `${dia}/${mes}/${anio}`;
}

/** Fecha de hoy en Guatemala (YYYY-MM-DD). */
export function hoyLocal(): string {
  const p = partesEnZona(new Date());
  return `${p.y}-${p.m}-${p.d}`;
}

/** Timestamp actual en Guatemala (YYYY-MM-DD HH:mm:ss). */
export function ahoraLocal(): string {
  const p = partesEnZona(new Date());
  return `${p.y}-${p.m}-${p.d} ${p.hh}:${p.mm}:${p.ss}`;
}

export function horaAhora(): string {
  const p = partesEnZona(new Date());
  return `${p.hh}:${p.mm}:${p.ss}`;
}

/** Extrae HH:MM de un timestamp. */
export function horaCorta(value: string | Date | null | undefined): string {
  const ts = fmtTs(value);
  if (!ts) return "";
  const parte = ts.includes(" ") ? ts.split(" ")[1] : ts;
  return (parte || "").slice(0, 5);
}

/**
 * Normaliza a YYYY-MM-DD HH:mm:ss.
 * DATETIME de MySQL se trata como reloj de pared (Guatemala), sin convertir zona.
 */
export function fmtTs(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    // mysql2 + timezone local: los componentes locales reflejan el valor guardado.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    const ss = String(value.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }
  const raw = String(value).trim();
  // ISO con Z / offset: convertir a reloj de Guatemala.
  if (/[zZ]$/.test(raw) || /[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const p = partesEnZona(d);
      return `${p.y}-${p.m}-${p.d} ${p.hh}:${p.mm}:${p.ss}`;
    }
  }
  return raw.replace("T", " ").slice(0, 19);
}

export function formatearTimestampVisible(
  value: string | Date | null | undefined,
): string {
  if (value == null || value === "") return "—";
  const s = fmtTs(value);
  if (!s) return "—";
  const [fecha, hora] = s.split(" ");
  if (!fecha) return s;
  const [y, m, d] = fecha.split("-");
  if (!y || !m || !d) return s;
  return hora ? `${d}/${m}/${y} ${hora}` : `${d}/${m}/${y}`;
}

export function normalizarHora(valor: string): string | null {
  const t = valor.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] ?? "0");
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Convierte una columna SQL DATE (fecha calendario, SIN hora ni timezone) a
 * "YYYY-MM-DD". Usa los componentes LOCALES del Date que mysql2 devuelve —
 * mismo principio que fmtTs() ya usa para DATETIME/TIMESTAMP con
 * `timezone: "local"` (ver src/lib/db.ts): esos componentes reflejan
 * exactamente el valor guardado, sin volver a interpretarlo por zona
 * horaria.
 *
 * RRHH-FECHAS-DATE-TIMEZONE: antes esta función usaba partesEnZona()
 * (conversión explícita a America/Guatemala vía Intl), lo cual trata una
 * columna DATE como si fuera un INSTANTE real. mysql2 arma cualquier DATE
 * con hora 00:00:00 en la zona local del proceso; si esa zona no es
 * exactamente America/Guatemala (p. ej. UTC en el hosting), restar el
 * offset de Guatemala desde medianoche SIEMPRE cruza al día anterior → un
 * desfase de -1 día reproducible al 100% para toda fecha DATE. Bug
 * confirmado en producción (fecha_alta/fecha_inicio_laboral de empleados,
 * entre otras columnas DATE) — ver toIsoDate.test.ts.
 *
 * Para DATETIME/TIMESTAMP reales (instantes con hora) usar fmtTs(). Se
 * auditaron los 17 consumidores existentes de toIsoDate(): todos son
 * columnas DATE de calendario excepto `rrhh_descuento_cuotas.aplicado_en`
 * (DATETIME), cuyas 2 llamadas en descuentos.ts se movieron a
 * toIsoDateDesdeInstante() para no tocar semántica de DATETIME/TIMESTAMP
 * en este ticket.
 */
export function toIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}

/**
 * Comportamiento ORIGINAL (pre-fix) de toIsoDate() para Date: convierte un
 * INSTANTE real a su fecha calendario en America/Guatemala vía Intl. Existe
 * únicamente para `rrhh_descuento_cuotas.aplicado_en` (DATETIME, "fecha/hora
 * de aplicación a planilla" — ver src/lib/rrhh/descuentos.ts), el único
 * consumidor no-DATE detectado en la auditoría de RRHH-FECHAS-DATE-TIMEZONE.
 * Este ticket corrige explícitamente solo columnas DATE de calendario, no
 * DATETIME/TIMESTAMP — no usar para nada nuevo sin confirmar primero que el
 * valor es un instante real, no una fecha de calendario (para eso está
 * toIsoDate()).
 */
export function toIsoDateDesdeInstante(
  value: string | Date | null | undefined,
): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const p = partesEnZona(value);
    return `${p.y}-${p.m}-${p.d}`;
  }
  return String(value).slice(0, 10);
}

/**
 * RRHH — Justificación de faltas desde Reportes de asistencia: parte PURA (sin BD), segura para componentes de cliente.
 *
 * La justificación es una CAPA sobre la ausencia real: no crea marcajes, no borra ni reinterpreta la falta y no toca incidencias,
 * vacaciones ni planilla. El reporte muestra «Falta justificada» y conserva motivo, quién y cuándo.
 */

export const ESTADO_FALTA = "Falta";
export const ESTADO_FALTA_JUSTIFICADA = "Falta justificada";

export const ESTADOS_JUSTIFICACION = ["ACTIVA", "REVERTIDA"] as const;
export type EstadoJustificacion = (typeof ESTADOS_JUSTIFICACION)[number];

/**
 * Motivos de justificación: se REUTILIZA el catálogo existente de tipos de incidencia (`TIPOS_INCIDENCIA` en `periodos.ts`) sin
 * inventar uno nuevo, EXCLUYENDO los que tienen efecto propio sobre el saldo de vacaciones o que son la propia falta:
 * «Vacaciones», «A cuenta de Vacaciones» y «Falta». Una prueba verifica que cada valor siga existiendo en el catálogo original.
 */
export const TIPOS_JUSTIFICACION = [
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Médico",
  "Fallecimiento de Familiar",
  "Nacimiento de Hijo",
  "Enfermedad",
  "Sin Goce de Salario",
  "Matrimonio",
  "Citaciones Judiciales",
  "Cumpleaños",
  "Suspensión",
  "Otro",
] as const;
export type TipoJustificacion = (typeof TIPOS_JUSTIFICACION)[number];

export const OBSERVACION_JUSTIFICACION_MAX = 500;
export const MOTIVO_REVERSION_MIN = 5;
export const MOTIVO_REVERSION_MAX = 300;

export type ResultadoValidacion<T> = { ok: true; valor: T } | { ok: false; error: string };

export function validarTipoJustificacion(v: unknown): ResultadoValidacion<TipoJustificacion> {
  if (typeof v !== "string") return { ok: false, error: "Selecciona el tipo de justificación." };
  const t = v.trim();
  return (TIPOS_JUSTIFICACION as readonly string[]).includes(t)
    ? { ok: true, valor: t as TipoJustificacion }
    : { ok: false, error: "El tipo de justificación no es válido." };
}

export function validarObservacionJustificacion(v: unknown): ResultadoValidacion<string | null> {
  if (v == null) return { ok: true, valor: null };
  if (typeof v !== "string") return { ok: false, error: "La observación no es válida." };
  const t = v.trim();
  if (!t) return { ok: true, valor: null };
  if (t.length > OBSERVACION_JUSTIFICACION_MAX) {
    return { ok: false, error: `La observación no puede superar ${OBSERVACION_JUSTIFICACION_MAX} caracteres.` };
  }
  return { ok: true, valor: t };
}

export function validarMotivoReversion(v: unknown): ResultadoValidacion<string> {
  if (typeof v !== "string") return { ok: false, error: "El motivo es obligatorio." };
  const t = v.trim();
  if (t.length < MOTIVO_REVERSION_MIN) return { ok: false, error: `El motivo debe tener al menos ${MOTIVO_REVERSION_MIN} caracteres.` };
  if (t.length > MOTIVO_REVERSION_MAX) return { ok: false, error: `El motivo no puede superar ${MOTIVO_REVERSION_MAX} caracteres.` };
  return { ok: true, valor: t };
}

/** Resumen de la justificación que viaja en cada fila del reporte (sin evidencia ni datos sensibles). */
export type JustificacionResumen = {
  id: number;
  tipo: string;
  observacion: string | null;
  version: number;
  creadoPor: string;
  creadoEn: string;
};

/** ¿La fila del reporte es una falta (con o sin justificación)? Solo estas filas abren el modal con doble clic. */
export function esFilaFalta(fila: { estadoEntrada: string }): boolean {
  return fila.estadoEntrada === ESTADO_FALTA || fila.estadoEntrada === ESTADO_FALTA_JUSTIFICADA;
}

/** Fecha calendario YYYY-MM-DD válida. */
export function fechaCalendarioValida(f: unknown): f is string {
  if (typeof f !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false;
  const [y, m, d] = f.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Tipo de documento (`documentos_empleados.tipo_documento`) de la evidencia de una justificación de ESA fecha. */
export function tipoDocumentoEvidenciaJustificacion(fecha: string): string {
  return `Justificación de falta ${fecha}`;
}

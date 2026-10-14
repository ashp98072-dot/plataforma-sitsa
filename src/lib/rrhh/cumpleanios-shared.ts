/**
 * RRHH — Cumpleaños por mes: parte PURA (sin BD), segura para importar desde componentes de cliente. Las consultas viven en
 * `cumpleanios.ts`. Solo expone lo mínimo para preparar pedidos (código, nombre, fecha, edad, puesto, área).
 */

export const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
] as const;

export const ANIO_MINIMO = 2000;
export const ANIO_MAXIMO = 2100;
/** Tope defensivo de filas de un listado mensual (una empresa real no se acerca; evita respuestas desmedidas). */
export const MAX_FILAS_CUMPLEANIOS = 2000;

export function nombreMes(mes: number): string {
  return MESES_ES[mes - 1] ?? "";
}

/** Mes 1..12 desde texto/número; `null` si no es un entero válido. */
export function parseMes(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,2}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

export function parseAnio(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{4}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= ANIO_MINIMO && n <= ANIO_MAXIMO ? n : null;
}

export type FechaCumpleanios = {
  /** Día y mes REALES de nacimiento con el año consultado (YYYY-MM-DD); es una etiqueta de listado, no una fecha de calendario. */
  iso: string;
  dia: number;
  mes: number;
};

/**
 * Fecha de cumpleaños en el año consultado = día y mes REALES de nacimiento + año consultado. No se asume ninguna convención de
 * celebración: quien nació un 29 de febrero se muestra como 29 de febrero aunque el año consultado no sea bisiesto (el listado
 * identifica cumpleaños del mes, no una fecha legal/operativa). `null` si la fecha de nacimiento no es válida.
 */
export function fechaCumpleanios(fechaNacimientoIso: string | null | undefined, anio: number): FechaCumpleanios | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaNacimientoIso ?? ""));
  if (!m) return null;
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return { iso: `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`, dia, mes };
}

/** Edad que cumple en el año consultado = año consultado − año de nacimiento. `null` si el dato no es coherente (< 1). */
export function edadQueCumple(fechaNacimientoIso: string | null | undefined, anio: number): number | null {
  const m = /^(\d{4})-/.exec(String(fechaNacimientoIso ?? ""));
  if (!m) return null;
  const edad = anio - Number(m[1]);
  return edad >= 1 ? edad : null;
}

export type CumpleaniosEmpleado = {
  id: number;
  codigo: string;
  nombre: string;
  puesto: string;
  area: string;
  estado: string;
  /** Fecha de cumpleaños en el año consultado (YYYY-MM-DD). */
  fecha: string;
  dia: number;
  edad: number | null;
  /** Cantidad de comprobantes (tarjeta/vale entregado) de ESTE año; 0 = sin comprobante. */
  comprobantes: number;
};

export type ListadoCumpleanios = {
  mes: number;
  anio: number;
  nombreMes: string;
  incluirInactivos: boolean;
  total: number;
  truncado: boolean;
  empleados: CumpleaniosEmpleado[];
};

export type ResumenCumpleanios = {
  mes: number;
  anio: number;
  nombreMes: string;
  total: number;
  /** Próximos cumpleaños del mes (desde hoy si es el mes actual; si no, los primeros del mes). */
  proximos: { id: number; nombre: string; dia: number; fecha: string }[];
};

/** Prefijo y tipo (`documentos_empleados.tipo_documento`) del comprobante de cumpleaños de un AÑO (empresa + empleado + año). */
export const PREFIJO_COMPROBANTE_CUMPLEANIOS = "Comprobante de cumpleaños ";
export function tipoDocumentoComprobanteCumpleanios(anio: number): string {
  return `${PREFIJO_COMPROBANTE_CUMPLEANIOS}${anio}`;
}

/** Nombre de archivo sugerido: `Cumpleanios_Octubre_2026.xlsx` (sin tildes ni eñes). */
export function nombreArchivoCumpleanios(mes: number, anio: number): string {
  const mesAscii = nombreMes(mes).normalize("NFD").replace(/[̀-ͯ]/g, "");
  return `Cumpleanios_${mesAscii}_${anio}.xlsx`;
}

export const ENCABEZADOS_CUMPLEANIOS = [
  "Código", "Empleado", "Fecha de cumpleaños", "Edad que cumple", "Puesto", "Área", "Comprobante",
] as const;

/** Filas del Excel: las columnas pedidas + «Comprobante» (Sí/No), sin datos sensibles, sin archivos ni URLs. */
export function filasExcelCumpleanios(empleados: CumpleaniosEmpleado[]): string[][] {
  return empleados.map((e) => [
    e.codigo,
    e.nombre,
    `${String(e.dia).padStart(2, "0")}/${e.fecha.slice(5, 7)}/${e.fecha.slice(0, 4)}`,
    e.edad == null ? "" : String(e.edad),
    e.puesto,
    e.area,
    e.comprobantes > 0 ? "Sí" : "No",
  ]);
}

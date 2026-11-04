import Decimal from "decimal.js";
import { TEXTO_SIN_ENTIDAD, importe } from "./cuentas-por-cobrar-shared";

/**
 * MIL-CXC-ANT-01 — Antigüedad de saldos de Cuentas por cobrar (MVP). Módulo PURO (seguro para componentes cliente).
 *
 * Antigüedad = días transcurridos DESDE LA FECHA DE EMISIÓN hasta la fecha de corte. NO es morosidad: la plataforma aún no guarda
 * fecha de vencimiento ni días de crédito, así que «días vencidos» NO se calcula ni se muestra. Saldo ACTUAL (no histórico).
 */

export const ROTULO_ANTIGUEDAD =
  "Antigüedad desde la fecha de emisión, a la fecha de corte indicada. No indica morosidad ni vencimiento (la plataforma no guarda fecha de vencimiento). Saldo actual informativo; no sustituye la cartera legal de Milenium.";
export const NOTA_EXPORTACION_ANTIGUEDAD =
  "Saldos ACTUALES al momento de generar el archivo (pueden variar si se registraron cobros después de la consulta en pantalla). La fecha de corte solo fija el cálculo de días desde emisión; no representa un saldo histórico. Importes en la moneda de cada factura; nunca se suman monedas distintas.";
export const TEXTO_DIAS_VENCIDOS_NO_DISPONIBLE = "No disponible";

export const TRAMOS_ANTIGUEDAD = ["0-15", "16-30", "31-60", "61-90", "90+"] as const;
export type TramoAntiguedad = (typeof TRAMOS_ANTIGUEDAD)[number];
export const ETIQUETA_TRAMO: Record<TramoAntiguedad, string> = {
  "0-15": "0–15 días",
  "16-30": "16–30 días",
  "31-60": "31–60 días",
  "61-90": "61–90 días",
  "90+": "Más de 90 días",
};

/** Tramo según días desde emisión. Un valor negativo (fecha de emisión posterior al corte) se trata como 0. Fronteras inclusivas. */
export function tramoDe(dias: number): TramoAntiguedad {
  const d = Math.max(0, Math.trunc(dias));
  if (d <= 15) return "0-15";
  if (d <= 30) return "16-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(v: string | null | undefined): string | undefined {
  if (!v || !FECHA_RE.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}

/** Días calendario entre dos fechas AAAA-MM-DD (sin horas ni zona). */
export function diasEntre(emision: string, corte: string): number {
  const a = fechaValida(emision), b = fechaValida(corte);
  if (!a || !b) return 0;
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Fecha de hoy en Guatemala (AAAA-MM-DD), independiente de la zona del servidor. */
export function hoyGuatemala(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);
}

export type FiltroEntidadAnt = number | "sin";
export type FiltrosAntiguedad = {
  clienteId?: number;
  entidad?: FiltroEntidadAnt;
  moneda?: string;
  tramo?: TramoAntiguedad;
  page?: number;
  pageSize?: number;
};

export const PAGE_SIZE_ANT_DEFECTO = 25;
export const PAGE_SIZE_ANT_MAXIMO = 100;
export const LIMITE_EXPORTACION_ANT = 20000;

const ENTERO_RE = /^[0-9]{1,10}$/;
const INT_MAX = 2_147_483_647;
const PAGE_MAX = 1_000_000;

const entero = (v: string, max: number): number | undefined => {
  if (!ENTERO_RE.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 && n <= max ? n : undefined;
};

/**
 * Fecha de corte conservada para la EXPORTACIÓN: solo hoy o ayer (Guatemala). Sirve únicamente para que el Excel calcule los días
 * desde emisión con la misma fecha que la pantalla cuando la medianoche se cruzó entre ambas solicitudes. NO habilita reportes
 * históricos: los saldos siempre son los ACTUALES al generar el archivo (pueden variar si se registraron cobros entre ambas
 * solicitudes) y una fecha conservada no representa un saldo histórico.
 */
export function validarCorte(valor: string, ahora: Date = new Date()): { ok: true; corte: string } | { ok: false; error: string } {
  const v = fechaValida(valor);
  if (!v) return { ok: false, error: "Fecha de corte inválida: use AAAA-MM-DD (fecha real)." };
  const hoy = hoyGuatemala(ahora);
  if (v !== hoy && diasEntre(v, hoy) !== 1) {
    return { ok: false, error: "La fecha de corte solo puede ser la de hoy o la de ayer; actualice el reporte para generar el archivo. Los reportes históricos no están disponibles." };
  }
  return { ok: true, corte: v };
}

export type ResultadoFiltros = { ok: true; filtros: FiltrosAntiguedad; corte?: string } | { ok: false; error: string };

/**
 * Filtros desde la query string, ESTRICTOS: un valor explícito inválido (vacío, repetido, fuera de rango o desconocido) se RECHAZA
 * —nunca se convierte en «todos»—. Parámetros que no son filtros (p. ej. empresaId) se ignoran: la empresa sale de la sesión.
 * `corte` solo se acepta si `permitirCorte` (exportación).
 */
export function filtrosAntiguedadDesdeParams(p: URLSearchParams, opciones: { permitirCorte?: boolean; ahora?: Date } = {}): ResultadoFiltros {
  const f: FiltrosAntiguedad = {};
  const leer = (k: string): string | null | { error: string } => {
    const vs = p.getAll(k);
    if (vs.length === 0) return null;
    if (vs.length > 1) return { error: `Parámetro «${k}» repetido.` };
    const v = vs[0].trim();
    return v === "" ? { error: `Parámetro «${k}» vacío: omítalo o indique un valor.` } : v;
  };
  const invalido = (k: string, detalle: string) => ({ ok: false as const, error: `Valor inválido en «${k}»: ${detalle}.` });

  const cliente = leer("clienteId");
  if (cliente !== null) {
    if (typeof cliente !== "string") return { ok: false, error: cliente.error };
    const n = entero(cliente, INT_MAX);
    if (!n) return invalido("clienteId", "se espera un entero positivo");
    f.clienteId = n;
  }
  const ent = leer("entidad");
  if (ent !== null) {
    if (typeof ent !== "string") return { ok: false, error: ent.error };
    if (ent === "sin") f.entidad = "sin";
    else {
      const n = entero(ent, INT_MAX);
      if (!n) return invalido("entidad", "se espera un entero positivo o «sin»");
      f.entidad = n;
    }
  }
  const mon = leer("moneda");
  if (mon !== null) {
    if (typeof mon !== "string") return { ok: false, error: mon.error };
    if (!/^[A-Za-z]{3}$/.test(mon)) return invalido("moneda", "se espera un código de 3 letras (p. ej. GTQ)");
    f.moneda = mon.toUpperCase();
  }
  const tr = leer("tramo");
  if (tr !== null) {
    if (typeof tr !== "string") return { ok: false, error: tr.error };
    if (!(TRAMOS_ANTIGUEDAD as readonly string[]).includes(tr)) return invalido("tramo", `use uno de ${TRAMOS_ANTIGUEDAD.join(", ")}`);
    f.tramo = tr as TramoAntiguedad;
  }
  const page = leer("page");
  if (page !== null) {
    if (typeof page !== "string") return { ok: false, error: page.error };
    const n = entero(page, PAGE_MAX);
    if (!n) return invalido("page", "se espera un entero positivo");
    f.page = n;
  }
  const size = leer("pageSize");
  if (size !== null) {
    if (typeof size !== "string") return { ok: false, error: size.error };
    const n = entero(size, PAGE_SIZE_ANT_MAXIMO);
    if (!n) return invalido("pageSize", `se espera un entero entre 1 y ${PAGE_SIZE_ANT_MAXIMO}`);
    f.pageSize = n;
  }
  const corte = leer("corte");
  if (corte !== null) {
    if (typeof corte !== "string") return { ok: false, error: corte.error };
    if (!opciones.permitirCorte) return { ok: false, error: "«corte» solo se admite al exportar." };
    const c = validarCorte(corte, opciones.ahora);
    if (!c.ok) return c;
    return { ok: true, filtros: f, corte: c.corte };
  }
  return { ok: true, filtros: f };
}

export function paginacionAntiguedad(f: { page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(1, f.pageSize ?? PAGE_SIZE_ANT_DEFECTO), PAGE_SIZE_ANT_MAXIMO);
  const page = Math.max(1, f.page ?? 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export type FilaAntiguedad = {
  facturaId: number;
  clienteId: number;
  cliente: string;
  numeroFactura: string | null;
  fechaEmision: string;
  diasDesdeEmision: number;
  montoOriginal: string;
  montoCobrado: string;
  saldoPendiente: string;
  moneda: string;
  entidadId: number | null;
  entidad: string;
  tramo: TramoAntiguedad;
};

export type TotalAntiguedad = { moneda: string; tramo: TramoAntiguedad; facturas: number; saldo: string };
export type TotalMoneda = { moneda: string; facturas: number; saldo: string };

export type RespuestaAntiguedad = {
  filas: FilaAntiguedad[];
  totalReal: number;
  page: number;
  pageSize: number;
  fechaCorte: string;
  totalesPorTramo: TotalAntiguedad[];
  totalesPorMoneda: TotalMoneda[];
  rotulo: string;
};

export const nombreEntidadAnt = (id: number | null, nombre: unknown) =>
  id == null ? TEXTO_SIN_ENTIDAD : nombre != null && String(nombre).trim() ? String(nombre) : `Entidad #${id}`;

/** Saldo exacto = monto − cobrado, con Decimal (nunca float). */
export const saldoExacto = (monto: unknown, cobrado: unknown): string => new Decimal(importe(monto)).minus(importe(cobrado)).toFixed(2);

export const COLUMNAS_EXPORTACION_ANT = [
  "Cliente", "Factura", "Fecha de emisión", "Días desde emisión", "Tramo", "Monto original", "Monto cobrado", "Saldo pendiente", "Moneda", "Entidad",
] as const;

export function filaExportacionAnt(f: FilaAntiguedad): string[] {
  return [
    f.cliente, f.numeroFactura ?? "", f.fechaEmision, String(f.diasDesdeEmision), ETIQUETA_TRAMO[f.tramo],
    f.montoOriginal, f.montoCobrado, f.saldoPendiente, f.moneda, f.entidad,
  ];
}

/**
 * Presentación de importes SIN pasar por Number: el servidor ya entrega cadenas con 2 decimales (DECIMAL(14,2) y sus sumas). Se
 * agrupan los miles sobre la cadena, de modo que ningún centavo se pierde, sea cual sea la magnitud.
 */
export function formatearImporte(moneda: string, v: unknown): string {
  const t = importe(v);
  const neg = t.startsWith("-");
  const [ent, dec] = (neg ? t.slice(1) : t).split(".");
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${moneda} ${neg ? "-" : ""}${miles}.${dec ?? "00"}`;
}

/** Máximo de dígitos significativos que un número de Excel (doble IEEE-754) conserva exactos como decimal. */
const DIGITOS_EXACTOS_EXCEL = 15;

/**
 * Valor de celda de Excel para un importe: NÚMERO (sumable) solo si ida y vuelta es exacta (≤ 15 dígitos significativos y
 * `Number(v).toFixed(2) === v`); si no, TEXTO con la cadena exacta del servidor. Cubre todo DECIMAL(14,2) (≤ 14 dígitos); solo las
 * sumas gigantes (≥ 16 dígitos) caen a texto, nunca se redondean en silencio.
 */
export function valorCeldaImporte(v: unknown): number | string {
  const t = importe(v);
  const digitos = t.replace(/[-.]/g, "").replace(/^0+(?=\d)/, "").length;
  const n = Number(t);
  return digitos <= DIGITOS_EXACTOS_EXCEL && Number.isFinite(n) && n.toFixed(2) === t ? n : t;
}

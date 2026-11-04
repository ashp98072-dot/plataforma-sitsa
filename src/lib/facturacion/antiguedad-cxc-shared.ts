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
export const NOTA_EXPORTACION_ANTIGUEDAD = "Saldo actual al momento de generar el reporte. Importes en la moneda de cada factura; nunca se suman monedas distintas.";
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

const MONEDA_RE = /^[A-Z]{3}$/;
const entero = (v: string | null): number | undefined => {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/** Filtros desde la query string. Valores inválidos se ignoran (nunca se interpolan en SQL). */
export function filtrosAntiguedadDesdeParams(p: URLSearchParams): FiltrosAntiguedad {
  const f: FiltrosAntiguedad = {};
  const cliente = entero(p.get("clienteId"));
  if (cliente) f.clienteId = cliente;
  const ent = (p.get("entidad") ?? "").trim();
  if (ent === "sin") f.entidad = "sin";
  else if (entero(ent)) f.entidad = entero(ent);
  const mon = (p.get("moneda") ?? "").trim().toUpperCase();
  if (MONEDA_RE.test(mon)) f.moneda = mon;
  const tr = (p.get("tramo") ?? "").trim();
  if ((TRAMOS_ANTIGUEDAD as readonly string[]).includes(tr)) f.tramo = tr as TramoAntiguedad;
  const page = entero(p.get("page"));
  if (page) f.page = page;
  const size = entero(p.get("pageSize"));
  if (size) f.pageSize = Math.min(size, PAGE_SIZE_ANT_MAXIMO);
  return f;
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

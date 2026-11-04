import Decimal from "decimal.js";
import {
  LIMITE_EXPORTACION_ANT,
  PAGE_SIZE_ANT_DEFECTO,
  PAGE_SIZE_ANT_MAXIMO,
  TRAMOS_ANTIGUEDAD,
  validarCorte,
  type TramoAntiguedad,
} from "@/lib/facturacion/antiguedad-cxc-shared";

/**
 * MIL-CXP-01 — Antigüedad de saldos y estado de cuenta de PROVEEDORES (Cuentas por pagar). Módulo PURO (seguro para el cliente).
 *
 * Qué mide: saldo ACTUAL de cada factura de proveedor REGISTRADA = monto pagadero (total − retención de ISR) − pagos REGISTRADOS
 * (los reversados no cuentan; la retención NO es un pago). La ANTIGÜEDAD se cuenta desde la FECHA DEL DOCUMENTO. Los «días vencidos» solo
 * existen cuando la factura tiene fecha de vencimiento (hoy se captura a mano y es opcional): nunca se infiere ni se inventa un vencimiento.
 * Comparte con CxC los helpers neutrales de tramos/fechas/formato (no se duplican).
 */
export {
  ETIQUETA_TRAMO,
  TRAMOS_ANTIGUEDAD,
  diasEntre,
  formatearImporte,
  hoyGuatemala,
  tramoDe,
  validarCorte,
  valorCeldaImporte,
  type TramoAntiguedad,
} from "@/lib/facturacion/antiguedad-cxc-shared";
export { LIMITE_EXPORTACION_ANT, PAGE_SIZE_ANT_MAXIMO };

export const ROTULO_ANTIGUEDAD_CXP =
  "Antigüedad desde la fecha del documento del proveedor, a la fecha de corte indicada. Los días vencidos se calculan solo cuando la factura tiene fecha de vencimiento (se captura a mano); sin vencimiento se muestra «Sin vencimiento». Saldo actual = monto pagadero (total menos retención de ISR) menos los pagos registrados. Importes en quetzales (la moneda no se registra en CxP). Informativo: no sustituye a Milenium.";
export const NOTA_EXPORTACION_CXP =
  "Saldos ACTUALES al momento de generar el archivo (pueden variar si se registraron pagos después de la consulta en pantalla). La fecha de corte solo fija el cálculo de días; no representa un saldo histórico.";

export const SITUACIONES_VENCIMIENTO = ["VENCIDA", "VIGENTE", "SIN_VENCIMIENTO"] as const;
export type SituacionVencimiento = (typeof SITUACIONES_VENCIMIENTO)[number];
export const ETIQUETA_SITUACION: Record<SituacionVencimiento, string> = {
  VENCIDA: "Vencida", VIGENTE: "Vigente (no vencida)", SIN_VENCIMIENTO: "Sin vencimiento",
};

/**
 * Situación respecto del vencimiento a la fecha de corte. Vencida = vencimiento ANTERIOR al corte (el día del vencimiento aún no está vencida).
 * Sin fecha de vencimiento NO se clasifica como vigente ni como vencida.
 */
export function situacionVencimiento(fechaVencimiento: string | null, corte: string): SituacionVencimiento {
  if (!fechaVencimiento) return "SIN_VENCIMIENTO";
  return fechaVencimiento < corte ? "VENCIDA" : "VIGENTE";
}

export type FiltrosAntiguedadCxp = {
  proveedorId?: number;
  tramo?: TramoAntiguedad;
  situacion?: SituacionVencimiento;
  page?: number;
  pageSize?: number;
};

const INT_MAX = 2_147_483_647;
const PAGE_MAX = 1_000_000;
const ENTERO_RE = /^[0-9]{1,10}$/;
const entero = (v: string, max: number): number | undefined => (ENTERO_RE.test(v) && Number(v) >= 1 && Number(v) <= max ? Number(v) : undefined);

export type ResultadoFiltrosCxp = { ok: true; filtros: FiltrosAntiguedadCxp; corte?: string } | { ok: false; error: string };

/**
 * Filtros ESTRICTOS desde la query string: un valor explícito inválido, vacío o repetido se RECHAZA (HTTP 400); nunca se convierte en «todos».
 * `entidad` lo valida el ámbito contable (exactamente una entidad) y aquí se ignora; empresa nunca se lee de la query. `corte` solo al exportar.
 */
export function filtrosAntiguedadCxpDesdeParams(p: URLSearchParams, opciones: { permitirCorte?: boolean; ahora?: Date } = {}): ResultadoFiltrosCxp {
  const leer = (k: string): string | null | { error: string } => {
    const vs = p.getAll(k);
    if (vs.length === 0) return null;
    if (vs.length > 1) return { error: `Parámetro «${k}» repetido.` };
    const v = vs[0].trim();
    return v === "" ? { error: `Parámetro «${k}» vacío: omítalo o indique un valor.` } : v;
  };
  const malo = (k: string, d: string) => ({ ok: false as const, error: `Valor inválido en «${k}»: ${d}.` });
  const f: FiltrosAntiguedadCxp = {};

  const prov = leer("proveedorId");
  if (prov !== null) {
    if (typeof prov !== "string") return { ok: false, error: prov.error };
    const n = entero(prov, INT_MAX);
    if (!n) return malo("proveedorId", "se espera un entero positivo");
    f.proveedorId = n;
  }
  const tr = leer("tramo");
  if (tr !== null) {
    if (typeof tr !== "string") return { ok: false, error: tr.error };
    if (!(TRAMOS_ANTIGUEDAD as readonly string[]).includes(tr)) return malo("tramo", `use uno de ${TRAMOS_ANTIGUEDAD.join(", ")}`);
    f.tramo = tr as TramoAntiguedad;
  }
  const sit = leer("situacion");
  if (sit !== null) {
    if (typeof sit !== "string") return { ok: false, error: sit.error };
    if (!(SITUACIONES_VENCIMIENTO as readonly string[]).includes(sit)) return malo("situacion", `use uno de ${SITUACIONES_VENCIMIENTO.join(", ")}`);
    f.situacion = sit as SituacionVencimiento;
  }
  const page = leer("page");
  if (page !== null) {
    if (typeof page !== "string") return { ok: false, error: page.error };
    const n = entero(page, PAGE_MAX);
    if (!n) return malo("page", "se espera un entero positivo");
    f.page = n;
  }
  const size = leer("pageSize");
  if (size !== null) {
    if (typeof size !== "string") return { ok: false, error: size.error };
    const n = entero(size, PAGE_SIZE_ANT_MAXIMO);
    if (!n) return malo("pageSize", `se espera un entero entre 1 y ${PAGE_SIZE_ANT_MAXIMO}`);
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

export function paginacionCxp(f: { page?: number; pageSize?: number }) {
  const pageSize = Math.min(Math.max(1, f.pageSize ?? PAGE_SIZE_ANT_DEFECTO), PAGE_SIZE_ANT_MAXIMO);
  const page = Math.max(1, f.page ?? 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export type FilaAntiguedadCxp = {
  facturaId: number;
  proveedorId: number;
  proveedor: string;
  serie: string;
  numero: string;
  fechaDocumento: string;
  fechaVencimiento: string | null;
  diasDesdeDocumento: number;
  /** null = la factura no tiene fecha de vencimiento; 0 = aún no vencida. */
  diasVencidos: number | null;
  situacion: SituacionVencimiento;
  totalDocumento: string;
  retencionIsr: string;
  montoPagadero: string;
  pagado: string;
  saldo: string;
  tramo: TramoAntiguedad;
};
export type TotalTramoCxp = { tramo: TramoAntiguedad; facturas: number; saldo: string };
export type TotalSituacionCxp = { situacion: SituacionVencimiento; facturas: number; saldo: string };
export type RespuestaAntiguedadCxp = {
  filas: FilaAntiguedadCxp[];
  totalReal: number;
  page: number;
  pageSize: number;
  fechaCorte: string;
  moneda: "GTQ";
  totalesPorTramo: TotalTramoCxp[];
  totalesPorSituacion: TotalSituacionCxp[];
  saldoTotal: string;
  rotulo: string;
};

/** Saldo exacto = monto pagadero − pagado (Decimal; nunca float). */
export const saldoCxp = (montoPagadero: unknown, pagado: unknown): string => new Decimal(String(montoPagadero ?? "0")).minus(String(pagado ?? "0")).toFixed(2);

export const COLUMNAS_EXPORTACION_CXP = [
  "Proveedor", "Documento", "Fecha del documento", "Días desde el documento", "Tramo", "Vencimiento", "Días vencidos", "Situación",
  "Total del documento", "Retención ISR", "Monto pagadero", "Pagado", "Saldo",
] as const;

export function filaExportacionCxp(f: FilaAntiguedadCxp, etiquetaTramo: (t: TramoAntiguedad) => string): string[] {
  return [
    f.proveedor, `${f.serie}-${f.numero}`, f.fechaDocumento, String(f.diasDesdeDocumento), etiquetaTramo(f.tramo), f.fechaVencimiento ?? "",
    f.diasVencidos == null ? "" : String(f.diasVencidos), ETIQUETA_SITUACION[f.situacion], f.totalDocumento, f.retencionIsr, f.montoPagadero, f.pagado, f.saldo,
  ];
}

/**
 * Estado de carga de la pantalla (PURO, probado): evita exportar con una lista ANTERIOR. Cada solicitud tiene una `clave` (entidad + filtros
 * + página). La lista solo se acepta si su respuesta corresponde a la ÚLTIMA clave solicitada (una respuesta tardía de una solicitud vieja se
 * ignora) y solo se puede exportar cuando NO hay recarga en curso y la lista mostrada es exactamente la de la clave vigente.
 */
export type EstadoCargaAntiguedad = {
  lista: RespuestaAntiguedadCxp | null;
  /** Clave de la solicitud a la que pertenece `lista`. */
  claveLista: string | null;
  /** Clave de la última solicitud emitida. */
  claveSolicitada: string | null;
  cargando: boolean;
  error: string;
};
export type AccionCargaAntiguedad =
  | { tipo: "SOLICITAR"; clave: string }
  | { tipo: "RESPUESTA"; clave: string; lista: RespuestaAntiguedadCxp }
  | { tipo: "FALLO"; clave: string; error: string };

export const estadoCargaInicial: EstadoCargaAntiguedad = { lista: null, claveLista: null, claveSolicitada: null, cargando: false, error: "" };

export function reducirCargaAntiguedad(s: EstadoCargaAntiguedad, a: AccionCargaAntiguedad): EstadoCargaAntiguedad {
  switch (a.tipo) {
    case "SOLICITAR":
      return { ...s, claveSolicitada: a.clave, cargando: true, error: "" };
    case "RESPUESTA":
      if (a.clave !== s.claveSolicitada) return s; // respuesta de una solicitud ya superada: se descarta
      return { ...s, lista: a.lista, claveLista: a.clave, cargando: false, error: "" };
    case "FALLO":
      if (a.clave !== s.claveSolicitada) return s;
      return { ...s, lista: null, claveLista: null, cargando: false, error: a.error };
  }
}

/** ¿Se puede exportar AHORA? Solo con una lista cargada que corresponde a la solicitud vigente y sin recarga en curso. */
export const puedeExportarAntiguedad = (s: EstadoCargaAntiguedad): boolean =>
  s.lista !== null && !s.cargando && s.claveLista !== null && s.claveLista === s.claveSolicitada;

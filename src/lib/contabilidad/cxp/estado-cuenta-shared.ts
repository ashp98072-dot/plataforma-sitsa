import Decimal from "decimal.js";
import {
  LIMITE_EXPORTACION_ANT,
  PAGE_SIZE_ANT_MAXIMO,
  validarCorte,
  paginacionCxp,
  type SituacionVencimiento,
} from "./antiguedad-shared";
import type { EstadoFinancieroCxp } from "./saldo";

/**
 * MIL-CXP-02 — Estado de cuenta por proveedor (Cuentas por pagar). Módulo PURO (seguro para el cliente).
 *
 * Es un estado de cuenta ACTUAL: documentos registrados en Novalvion con su saldo de HOY. NO es histórico (no reconstruye saldos a una fecha
 * ni por fecha contable), y no incluye notas de crédito, anticipos ni otros movimientos sin implementación y reglas contables confirmadas.
 * Reutiliza las definiciones de CxP: saldo = monto pagadero (total − retención de ISR) − pagos REGISTRADOS; la retención NO es un pago;
 * los pagos REVERSADOS se muestran (solo con permiso de Pagos) pero NO suman al pagado vigente.
 */
export { LIMITE_EXPORTACION_ANT, PAGE_SIZE_ANT_MAXIMO, paginacionCxp };

export const ROTULO_ESTADO_CUENTA =
  "Estado de cuenta de documentos registrados en Novalvion. Saldos actuales, no históricos. No incluye necesariamente documentos pendientes de migración desde Milenium.";
export const NOTA_MONEDA_ESTADO_CUENTA = "Importes en quetzales (GTQ): CxP no guarda moneda por factura.";
export const NOTA_EXPORTACION_ESTADO_CUENTA =
  "Saldos ACTUALES al momento de generar el archivo (pueden variar si se registraron pagos después de la consulta en pantalla). La fecha de corte solo fija el cálculo de días; no representa un saldo histórico. Las facturas anuladas muestran sus importes solo como información: su saldo exigible es cero y no suman a los totales.";
export const NOTA_SIN_PERMISO_PAGOS = "El detalle de pagos (líneas, referencias, medios y reversos) requiere además el permiso de Pagos de CxP.";

/**
 * SOBREAPLICADA = factura REGISTRADA cuyo pagado vigente SUPERA su monto pagadero (inconsistencia que el servicio de pagos impide; solo puede existir por datos alterados).
 * NO se presenta como «Pagada»: se clasifica aparte y se acompaña de la advertencia SOBREAPLICACION. Los importes originales no se modifican.
 */
export type EstadoDocumento = "ABIERTA" | "PAGADA" | "SOBREAPLICADA" | "ANULADA";
export type EstadoFinancieroFila = EstadoFinancieroCxp | "SOBREAPLICADA";
export const ETIQUETA_ESTADO_DOCUMENTO: Record<EstadoDocumento, string> = { ABIERTA: "Abierta", PAGADA: "Pagada", SOBREAPLICADA: "Sobreaplicada", ANULADA: "Anulada" };
export const ETIQUETA_ESTADO_FINANCIERO: Record<EstadoFinancieroFila, string> = { PENDIENTE: "Pendiente", PARCIAL: "Pago parcial", PAGADA: "Pagada", SOBREAPLICADA: "Sobreaplicada", ANULADA: "Anulada" };
export const TEXTO_SOBREAPLICADA = "Sobreaplicada (revisar: el pagado supera el monto pagadero)";
export const TEXTO_ANULADA = "Anulada (importes informativos)";
export const TEXTO_ANULADA_EXCEL = "Anulada (importes informativos; saldo exigible 0.00)";

/** Texto de estado ÚNICO para pantalla y Excel (misma clasificación en API, UI y archivo). `paraExcel` solo alarga el texto de las anuladas. */
export function textoEstadoDocumento(f: { estado: EstadoDocumento; estadoFinanciero: EstadoFinancieroFila }, paraExcel = false): string {
  if (f.estado === "ANULADA") return paraExcel ? TEXTO_ANULADA_EXCEL : TEXTO_ANULADA;
  if (f.estado === "SOBREAPLICADA") return TEXTO_SOBREAPLICADA;
  return paraExcel ? ETIQUETA_ESTADO_DOCUMENTO[f.estado] : `${ETIQUETA_ESTADO_DOCUMENTO[f.estado]} · ${ETIQUETA_ESTADO_FINANCIERO[f.estadoFinanciero]}`;
}

export type FiltrosEstadoCuenta = {
  proveedorId: number;
  incluirPagadas: boolean;
  incluirAnuladas: boolean;
  /** Fecha del DOCUMENTO (AAAA-MM-DD), inclusivas. Filtran facturas; NO reconstruyen saldos a esa fecha. */
  desde?: string;
  hasta?: string;
  page?: number;
  pageSize?: number;
};

const INT_MAX = 2_147_483_647;
const PAGE_MAX = 1_000_000;
const ENTERO_RE = /^[0-9]{1,10}$/;
const entero = (v: string, max: number): number | undefined => (ENTERO_RE.test(v) && Number(v) >= 1 && Number(v) <= max ? Number(v) : undefined);
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fechaReal = (v: string): boolean => FECHA_RE.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export type ResultadoFiltrosEstado = { ok: true; filtros: FiltrosEstadoCuenta; corte?: string } | { ok: false; error: string };

/**
 * Filtros ESTRICTOS desde la query string: proveedorId es OBLIGATORIO; valores inválidos, vacíos o repetidos se RECHAZAN (HTTP 400), nunca se
 * convierten en «todos». `incluirPagadas`/`incluirAnuladas` aceptan solo `0` o `1`. `desde`/`hasta` = fechas reales; desde ≤ hasta. `entidad` lo valida
 * el ámbito contable (se ignora aquí); la empresa nunca se lee de la query. `corte` solo al exportar (hoy o ayer, Guatemala).
 */
export function filtrosEstadoCuentaDesdeParams(p: URLSearchParams, opciones: { permitirCorte?: boolean; ahora?: Date } = {}): ResultadoFiltrosEstado {
  const leer = (k: string): string | null | { error: string } => {
    const vs = p.getAll(k);
    if (vs.length === 0) return null;
    if (vs.length > 1) return { error: `Parámetro «${k}» repetido.` };
    const v = vs[0].trim();
    return v === "" ? { error: `Parámetro «${k}» vacío: omítalo o indique un valor.` } : v;
  };
  const malo = (k: string, d: string) => ({ ok: false as const, error: `Valor inválido en «${k}»: ${d}.` });

  const prov = leer("proveedorId");
  if (prov === null) return { ok: false, error: "Indique el proveedor («proveedorId»)." };
  if (typeof prov !== "string") return { ok: false, error: prov.error };
  const proveedorId = entero(prov, INT_MAX);
  if (!proveedorId) return malo("proveedorId", "se espera un entero positivo");
  const f: FiltrosEstadoCuenta = { proveedorId, incluirPagadas: false, incluirAnuladas: false };

  for (const [k, destino] of [["incluirPagadas", "incluirPagadas"], ["incluirAnuladas", "incluirAnuladas"]] as const) {
    const v = leer(k);
    if (v === null) continue;
    if (typeof v !== "string") return { ok: false, error: v.error };
    if (v !== "0" && v !== "1") return malo(k, "use 0 o 1");
    f[destino] = v === "1";
  }
  for (const k of ["desde", "hasta"] as const) {
    const v = leer(k);
    if (v === null) continue;
    if (typeof v !== "string") return { ok: false, error: v.error };
    if (!fechaReal(v)) return malo(k, "use una fecha real AAAA-MM-DD");
    f[k] = v;
  }
  if (f.desde && f.hasta && f.desde > f.hasta) return { ok: false, error: "«desde» no puede ser posterior a «hasta»." };
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

export type LineaPagoEstado = {
  pagoId: number;
  fechaPago: string;
  medioPago: string;
  referencia: string;
  monto: string;
  estado: "REGISTRADO" | "REVERSADO";
  /** true = suma al pagado vigente; false (REVERSADO) = solo información del registro. */
  vigente: boolean;
  reversadoEn: string | null;
  motivoReversion: string | null;
};

export type FilaEstadoCuenta = {
  facturaId: number;
  serie: string;
  numero: string;
  documento: string;
  fechaDocumento: string;
  fechaVencimiento: string | null;
  diasDesdeDocumento: number;
  /** null = sin fecha de vencimiento (o factura anulada); 0 = aún no vencida. */
  diasVencidos: number | null;
  /** null en facturas anuladas (no adeudan). */
  situacion: SituacionVencimiento | null;
  estado: EstadoDocumento;
  estadoFinanciero: EstadoFinancieroFila;
  totalDocumento: string;
  retencionIsr: string;
  montoPagadero: string;
  /** Pagado VIGENTE (aplicaciones de pagos REGISTRADOS). Los reversados no suman. */
  pagado: string;
  /** Saldo EXIGIBLE: monto pagadero − pagado vigente en registradas; "0.00" en anuladas (sus importes arriba son solo informativos). */
  saldo: string;
  motivoAnulacion: string | null;
  /** Presente SOLO si el usuario tiene permiso de Pagos (el servidor no lo envía en otro caso). */
  pagos?: LineaPagoEstado[];
};

export type CodigoAdvertencia = "SOBREAPLICACION" | "PAGO_VIGENTE_EN_ANULADA" | "PAGO_DE_OTRO_PROVEEDOR" | "PAGO_DESCUADRADO" | "PAGADO_NO_COINCIDE_CON_LINEAS";
export type AdvertenciaIntegridad = { codigo: CodigoAdvertencia; mensaje: string; facturaId?: number; pagoId?: number; detalle: Record<string, string> };

export type TotalesEstadoCuenta = {
  /** Facturas REGISTRADAS (abiertas + pagadas + sobreaplicadas) del filtro. */
  registradas: { facturas: number; totalDocumento: string; retencionIsr: string; montoPagadero: string; pagado: string; saldoExigible: string };
  abiertas: { facturas: number; saldo: string };
  pagadas: { facturas: number };
  /** Registradas con pagado > pagadero: NO cuentan como pagadas; `exceso` = Σ (pagado − pagadero) solo informativo (no compensa saldos exigibles). */
  sobreaplicadas: { facturas: number; exceso: string };
  porSituacion: { situacion: SituacionVencimiento; facturas: number; saldo: string }[];
  /** Anuladas del filtro: importes INFORMATIVOS; no suman a ningún total ni adeudan. */
  anuladas: { facturas: number; totalDocumento: string; retencionIsr: string; montoPagadero: string };
};

export type ProveedorEstado = {
  id: number;
  nombre: string;
  nit: string | null;
  diasCredito: number | null;
  /** Solo con permiso de configuración fiscal y si existe configuración en esta entidad. Nunca datos bancarios. */
  regimenFiscal: "GENERAL" | "PEQUENO_CONTRIBUYENTE" | null;
  sujetoIsr: boolean | null;
};

export type RespuestaEstadoCuenta = {
  proveedor: ProveedorEstado;
  filtros: { incluirPagadas: boolean; incluirAnuladas: boolean; desde: string | null; hasta: string | null };
  filas: FilaEstadoCuenta[];
  totalReal: number;
  page: number;
  pageSize: number;
  fechaCorte: string;
  moneda: "GTQ";
  totales: TotalesEstadoCuenta;
  advertencias: AdvertenciaIntegridad[];
  advertenciasOmitidas: number;
  /** El usuario puede ver las líneas de pagos (permiso `cxp_pagos`). */
  pagosVisibles: boolean;
  rotulo: string;
  notaMoneda: string;
};

/** Saldo exigible de una factura registrada: monto pagadero − pagado vigente (CRUDO: puede ser negativo solo si hay sobreaplicación, que se advierte). */
export const saldoCrudo = (montoPagadero: unknown, pagado: unknown): string => new Decimal(String(montoPagadero ?? "0")).minus(String(pagado ?? "0")).toFixed(2);

/** Clasificación del documento para el estado de cuenta (la misma que usa el servidor en SQL): anulada · sobreaplicada · abierta · pagada. */
export function claseDocumento(estadoAdmin: "REGISTRADA" | "ANULADA", montoPagadero: unknown, pagado: unknown): EstadoDocumento {
  if (estadoAdmin === "ANULADA") return "ANULADA";
  const pagadero = new Decimal(String(montoPagadero)), vigente = new Decimal(String(pagado ?? "0"));
  if (vigente.greaterThan(pagadero)) return "SOBREAPLICADA";
  return pagadero.greaterThan(vigente) ? "ABIERTA" : "PAGADA";
}

export const COLUMNAS_FACTURAS_ESTADO = [
  "Documento", "Fecha del documento", "Vencimiento", "Días vencidos", "Situación", "Estado", "Total del documento", "Retención ISR", "Monto pagadero", "Pagado vigente", "Saldo exigible",
] as const;
export const COLUMNAS_PAGOS_ESTADO = ["Documento", "Fecha del pago", "Medio", "Referencia", "Monto aplicado", "Estado del pago", "Suma al pagado vigente", "Reversado en", "Motivo del reverso"] as const;

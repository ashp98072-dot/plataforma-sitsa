import Decimal from "decimal.js";

/**
 * M-2a — CUENTAS POR COBRAR INFORMATIVA (parte PURA, sin BD; segura para componentes de cliente).
 *
 * Fuente única: `fact_facturas` + `fact_pagos` (y `fact_pago_confirmaciones` solo como atributo informativo). `cont_cxc`
 * NO participa. Todo es SOLO LECTURA y se rotula como «saldo informativo»: no es la cartera legal de Milenium.
 *
 * Fuera de alcance (no inventar): vencimiento, antigüedad, días vencidos, retenciones reales, notas de crédito, anticipos,
 * saldo a favor y reversos.
 */

export const ROTULO_SALDO_INFORMATIVO =
  "Saldo informativo — documentos registrados en plataforma. No es la cartera legal de Milenium.";
export const NOTA_EXPORTACION = "Datos informativos de plataforma; no sustituyen la cartera legal de Milenium.";
export const TEXTO_VENCIMIENTO_NO_DISPONIBLE = "No disponible";
export const TEXTO_SIN_ENTIDAD = "Sin entidad";

export const ESTADOS_FINANCIEROS_DERIVADOS = ["SIN_PAGOS", "PARCIAL", "PAGADA", "ANULADA"] as const;
export type EstadoFinancieroDerivado = (typeof ESTADOS_FINANCIEROS_DERIVADOS)[number];

export const ETIQUETA_ESTADO_DERIVADO: Record<EstadoFinancieroDerivado, string> = {
  SIN_PAGOS: "Sin pagos",
  PARCIAL: "Pago parcial",
  PAGADA: "Pagada",
  ANULADA: "Anulada",
};

/** Solo estos estados administrativos participan: un Borrador aún no es un documento por cobrar. */
export const ESTADOS_ADMIN_CXC = ["Emitida", "Anulada"] as const;
export type EstadoAdminCxc = (typeof ESTADOS_ADMIN_CXC)[number];

export const VISTAS_CXC = ["cartera", "historial"] as const;
export type VistaCxc = (typeof VISTAS_CXC)[number];

/** Alcance del Historial: Todas / Abiertas / Pagadas / Anuladas. */
export const ALCANCES_HISTORIAL = ["todas", "abiertas", "pagadas", "anuladas"] as const;
export type AlcanceHistorial = (typeof ALCANCES_HISTORIAL)[number];

/** Entidad: número = entidad concreta; "sin" = facturas históricas con `entidad_id IS NULL`; undefined = todas (agrupadas). */
export type FiltroEntidad = number | "sin";

export type FiltrosCxc = {
  vista: VistaCxc;
  alcance?: AlcanceHistorial;
  clienteId?: number;
  entidad?: FiltroEntidad;
  estadoDerivado?: EstadoFinancieroDerivado;
  estadoAdmin?: EstadoAdminCxc;
  fechaDesde?: string;
  fechaHasta?: string;
  numeroFactura?: string;
  textoCliente?: string;
  page?: number;
  pageSize?: number;
};

export const PAGE_SIZE_DEFECTO = 25;
export const PAGE_SIZE_MAXIMO = 100;
/** Tope de filas de una exportación: si el filtro devuelve más, se pide acotar (nunca se trunca en silencio). */
export const LIMITE_EXPORTACION = 20000;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

function fechaValida(v: string | null): string | undefined {
  if (!v || !FECHA_RE.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? undefined : v;
}

function entero(v: string | null): number | undefined {
  if (v == null || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const acotar = (v: string | null, max: number) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, max) : undefined;
};

/** Parseo ESTRICTO de la query string: lo desconocido se ignora; nunca se confía en valores fuera de catálogo. */
export function filtrosDesdeParams(p: URLSearchParams, vistaPorDefecto: VistaCxc = "cartera"): FiltrosCxc {
  const vistaRaw = p.get("vista");
  const vista = (VISTAS_CXC as readonly string[]).includes(vistaRaw ?? "") ? (vistaRaw as VistaCxc) : vistaPorDefecto;
  const alcanceRaw = p.get("alcance");
  const estadoRaw = p.get("estado");
  const adminRaw = p.get("estadoAdmin");
  const entidadRaw = p.get("entidad");
  return {
    vista,
    alcance: (ALCANCES_HISTORIAL as readonly string[]).includes(alcanceRaw ?? "") ? (alcanceRaw as AlcanceHistorial) : undefined,
    clienteId: entero(p.get("clienteId")),
    entidad: entidadRaw === "sin" ? "sin" : entero(entidadRaw),
    estadoDerivado: (ESTADOS_FINANCIEROS_DERIVADOS as readonly string[]).includes(estadoRaw ?? "")
      ? (estadoRaw as EstadoFinancieroDerivado)
      : undefined,
    estadoAdmin: (ESTADOS_ADMIN_CXC as readonly string[]).includes(adminRaw ?? "") ? (adminRaw as EstadoAdminCxc) : undefined,
    fechaDesde: fechaValida(p.get("fechaDesde")),
    fechaHasta: fechaValida(p.get("fechaHasta")),
    numeroFactura: acotar(p.get("numeroFactura"), 60),
    textoCliente: acotar(p.get("textoCliente"), 120),
    page: entero(p.get("page")),
    pageSize: entero(p.get("pageSize")),
  };
}

/** Página y tamaño efectivos (acotados). */
export function paginacionEfectiva(f: { page?: number; pageSize?: number }): { page: number; pageSize: number; offset: number } {
  const pageSize = Math.min(Math.max(f.pageSize ?? PAGE_SIZE_DEFECTO, 1), PAGE_SIZE_MAXIMO);
  const page = Math.max(f.page ?? 1, 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const dos = (d: Decimal) => d.toFixed(2);

/** Normaliza un importe de BD a cadena con 2 decimales (nunca NaN: dato inválido ⇒ 0.00). */
export function importe(v: unknown): string {
  if (v == null || v === "") return "0.00";
  try {
    const d = new Decimal(String(v));
    return d.isFinite() ? dos(d) : "0.00";
  } catch {
    return "0.00";
  }
}

/** Saldo informativo = monto_total − Σ pagos. NO resta retención esperada, confirmaciones bancarias ni `cont_cxc`. */
export function saldoInformativo(montoTotal: unknown, totalPagado: unknown): string {
  return dos(new Decimal(importe(montoTotal)).minus(importe(totalPagado)));
}

/**
 * Estado financiero DERIVADO (no persistido). `null` para Borrador (no participa).
 *   ANULADA   ⇐ estado_admin = Anulada
 *   SIN_PAGOS ⇐ Emitida y total_pagado ≤ 0
 *   PARCIAL   ⇐ Emitida y 0 < total_pagado < monto_total
 *   PAGADA    ⇐ Emitida y total_pagado ≥ monto_total
 * LIMITACIÓN CONOCIDA: una retención real aplicada en Milenium no reduce el saldo aquí (ver M-2 §4).
 */
export function estadoDerivado(estadoAdmin: string, montoTotal: unknown, totalPagado: unknown): EstadoFinancieroDerivado | null {
  if (estadoAdmin === "Anulada") return "ANULADA";
  if (estadoAdmin !== "Emitida") return null;
  const pagado = new Decimal(importe(totalPagado));
  if (pagado.lte(0)) return "SIN_PAGOS";
  return pagado.lt(importe(montoTotal)) ? "PARCIAL" : "PAGADA";
}

/** ¿Pertenece a la cartera abierta? Emitida con saldo informativo > 0. */
export function esCarteraAbierta(estadoAdmin: string, montoTotal: unknown, totalPagado: unknown): boolean {
  return estadoAdmin === "Emitida" && new Decimal(importe(montoTotal)).minus(importe(totalPagado)).gt(0);
}

export type ConfirmacionBancariaResumen = {
  id: number;
  estado: "CONFIRMADA" | "ANULADA";
  monto: string;
  fechaAcreditacion: string;
  referencia: string;
  banco: string | null;
  alias: string | null;
};

export type PagoResumen = { id: number; fechaPago: string; monto: string; referencia: string | null; medioPago: string | null };

export type FilaCxc = {
  facturaId: number;
  clienteId: number;
  cliente: string;
  numeroFactura: string | null;
  entidadId: number | null;
  /** «Sin entidad» cuando `entidadId` es null (factura histórica): NUNCA se asigna automáticamente. */
  entidad: string;
  fechaEmision: string | null;
  estadoAdmin: EstadoAdminCxc;
  estadoFinanciero: EstadoFinancieroDerivado;
  condicionPago: "CREDITO" | "CONTADO" | null;
  montoOriginal: string;
  totalPagado: string;
  /** null en facturas Anuladas (no son cobrables). */
  saldoInformativo: string | null;
  /** Retención de IVA ESPERADA (informativa y congelada en la factura). NO altera el saldo. */
  retencionEsperada: { porcentaje: number; monto: string } | null;
  /** monto_total − retención esperada. Dato aparte; NO es el saldo. */
  netoEsperado: string | null;
  cantidadPagos: number;
  ultimaFechaPago: string | null;
  ultimaReferenciaPago: string | null;
  /** Atributo informativo; no suma al pago ni reduce el saldo. */
  confirmacionBancaria: {
    cantidadActivas: number;
    totalConfirmado: string;
    ultima: ConfirmacionBancariaResumen | null;
  };
  /** Siempre «No disponible»: el vencimiento no existe en el modelo actual (no se inventa). */
  vencimiento: typeof TEXTO_VENCIMIENTO_NO_DISPONIBLE;
};

export type TotalesPorEntidad = {
  entidadId: number | null;
  entidad: string;
  cantidad: number;
  montoOriginal: string;
  totalPagado: string;
  saldoInformativo: string;
};

export type RespuestaListaCxc = {
  filas: FilaCxc[];
  totalReal: number;
  page: number;
  pageSize: number;
  /** Totales SEPARADOS por entidad: KT y Mónaco no se mezclan. */
  porEntidad: TotalesPorEntidad[];
  rotulo: typeof ROTULO_SALDO_INFORMATIVO;
};

export type ResumenClienteCxc = {
  clienteId: number;
  cliente: string;
  nit: string | null;
  /** Una fila por entidad: nunca se suman entidades distintas. */
  porEntidad: {
    entidadId: number | null;
    entidad: string;
    totalFacturadoRegistrado: string;
    totalPagadoRegistrado: string;
    saldoInformativoAbierto: string;
    cantidadFacturas: number;
    abiertas: number;
    pagadas: number;
    anuladas: number;
  }[];
  rotulo: typeof ROTULO_SALDO_INFORMATIVO;
};

export type FilaClienteCxc = {
  clienteId: number;
  cliente: string;
  entidadId: number | null;
  entidad: string;
  cantidadFacturas: number;
  abiertas: number;
  pagadas: number;
  anuladas: number;
  totalFacturadoRegistrado: string;
  totalPagadoRegistrado: string;
  saldoInformativoAbierto: string;
};

export const COLUMNAS_EXPORTACION = [
  "Cliente",
  "Factura",
  "Entidad",
  "Fecha emisión",
  "Monto original",
  "Total pagado",
  "Saldo informativo",
  "Estado",
  "Condición de pago",
  "Retención esperada",
  "Neto esperado",
  "Último pago",
  "Referencia",
] as const;

/** Una fila exportable, en el orden de `COLUMNAS_EXPORTACION`. */
export function filaExportacion(f: FilaCxc): string[] {
  return [
    f.cliente,
    f.numeroFactura ?? "—",
    f.entidad,
    f.fechaEmision ?? "—",
    f.montoOriginal,
    f.totalPagado,
    f.saldoInformativo ?? "—",
    ETIQUETA_ESTADO_DERIVADO[f.estadoFinanciero],
    f.condicionPago ?? "—",
    f.retencionEsperada ? `${f.retencionEsperada.porcentaje}% · ${f.retencionEsperada.monto}` : "—",
    f.netoEsperado ?? "—",
    f.ultimaFechaPago ?? "—",
    f.ultimaReferenciaPago ?? f.confirmacionBancaria.ultima?.referencia ?? "—",
  ];
}

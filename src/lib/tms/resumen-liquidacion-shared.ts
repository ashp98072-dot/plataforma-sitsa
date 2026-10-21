import Decimal from "decimal.js";
import type { EstadoLiquidacionViaje } from "./liquidacion-viaje-shared";

/**
 * TMS — RESUMEN COMERCIAL DE LIQUIDACIÓN POR VIAJE (Fase 5). Parte PURA (sin BD), segura para componentes de cliente.
 *
 * Tres conceptos que NUNCA se mezclan:
 *   A. Tarifa base comercial            (tms_planes_viaje.tarifa_comercial)
 *   B. Cargos adicionales facturables   (módulo de cargos del viaje; vigentes = activo)
 *   C. Costos/gastos internos reales    (bloque SEPARADO; jamás entra al subtotal comercial)
 *
 * subtotal comercial = A + B  (ANTES de impuestos). No es «total factura»: el IVA de los cargos sigue pendiente de definición
 * de negocio/fiscal y aquí no se calcula, suma, resta ni se asume incluido.
 */

export const ETIQUETA_SUBTOTAL_COMERCIAL = "Subtotal comercial (antes de impuestos)";
export const NOTA_SUBTOTAL_COMERCIAL =
  "Tarifa base + cargos adicionales vigentes. No es el total de la factura: el tratamiento de IVA está pendiente de definición.";

export type CargoVigenteResumen = { id: number; concepto: string; monto: string; observacion: string | null };

export type BloqueComercial = {
  /** Cadena decimal con 2 decimales; null = el viaje no tiene tarifa asignada (no se inventa una base). */
  tarifaBase: string | null;
  moneda: string;
  cargosAdicionales: { cantidad: number; total: string; items: CargoVigenteResumen[] };
  /** tarifaBase + cargos vigentes; null si no hay tarifa base (no se presenta un subtotal sin base). */
  subtotalComercial: string | null;
  /** Siempre «PENDIENTE»: el IVA de cargos adicionales no está definido; este bloque no lo incluye ni lo calcula. */
  tratamientoIva: "PENDIENTE";
};

export type SnapshotComercialLiquidacion = {
  /** Versión de la liquidación que lo congeló y cuándo. */
  version: number;
  liquidadoEn: string;
  tarifaBase: string | null;
  moneda: string | null;
  /** false = liquidado antes de que existieran los cargos adicionales: el snapshot NO trae cargos (no se infieren). */
  incluyeCargos: boolean;
  cargosTotal: string | null;
  subtotalComercial: string | null;
  /** El resumen ACTUAL difiere de lo congelado (esperable en EN_AJUSTE; anómalo en LIQUIDADO). */
  difiereDelActual: boolean;
};

export type CategoriaCosto = { categoria: string; cantidad: number; total: string };

export type BloqueCostosInternos = {
  /**
   * Gastos operativos AUTORIZADOS y activos del viaje (dinero ya incurrido y aprobado). null = no consolidable en este
   * entorno (p. ej. la columna `estado` de Gastos aún no existe).
   */
  costoRegistrado: { total: string; porCategoria: CategoriaCosto[]; criterio: string } | null;
  /** Gastos del viaje que NO cuentan como costo registrado (no se suman): pendientes, rechazados e históricos sin flujo. */
  noIncluidos: {
    pendientes: { cantidad: number; total: string };
    rechazados: { cantidad: number };
    historicos: { cantidad: number; total: string };
  };
  /** Anticipos (solicitudes de fondo) vinculados al viaje: lo SOLICITADO, nunca el gasto real. No se suman al costo. */
  anticiposFondo: { lineas: number; montoSolicitado: string; porEstado: { estado: string; lineas: number; montoSolicitado: string }[]; nota: string };
  /** Costo del transportista externo registrado en el viaje (solo Tercerizado); se muestra aparte, no se suma. */
  costoTercerizado: string | null;
  moneda: "GTQ";
};

export type ResumenLiquidacionViaje = {
  plan: {
    id: number;
    codigo: string;
    estado: string;
    fechaPlan: string;
    cliente: string | null;
    ruta: { codigo: string | null; origen: string | null; destino: string | null };
  };
  liquidacion: {
    /** null = sin liquidación registrada. */
    estado: EstadoLiquidacionViaje | null;
    version: number | null;
    /** EN_AJUSTE: el resumen puede cambiar hasta volver a liquidar. */
    sujetoACambios: boolean;
    /** LIQUIDADO: liquidación finalizada. */
    finalizada: boolean;
  };
  comercial: BloqueComercial;
  /** Lo congelado por la última liquidación (LIQUIDADO/RELIQUIDADO), si existe. No se inventa un snapshot nuevo. */
  snapshotComercial: SnapshotComercialLiquidacion | null;
  /** true solo si el usuario tiene permiso de lectura de Gastos; si no, `costos` es null y NO se consultó la BD. */
  costosAutorizado: boolean;
  costos: BloqueCostosInternos | null;
  /** Margen informativo: solo cuando haya un costo interno real inequívoco y completo. Hoy NO disponible (ver motivo). */
  margen: { disponible: false; motivo: string };
  /** Conceptos que NO se consolidan todavía por falta de regla de negocio. */
  noConsolidado: string[];
};

export const MOTIVO_MARGEN_NO_DISPONIBLE =
  "No hay un costo interno real y completo por viaje: los viáticos, el combustible de Flota y los pagos a terceros no están vinculados " +
  "de forma inequívoca al viaje, y los fondos solicitados no equivalen al gasto real. Un margen calculado con costos parciales sería engañoso.";

export const NO_CONSOLIDADO_FASE5 = [
  "IVA / impuestos de la tarifa y de los cargos adicionales (pendiente de definición de negocio/fiscal)",
  "viáticos del viaje (monto programado vs. liquidado sin regla de costo real)",
  "combustible de Flota (sin vínculo por viaje)",
  "fondos solicitados como costo real (un anticipo no es un gasto)",
  "qué gastos vinculados deben cobrarse al cliente (ninguno se traslada al subtotal comercial)",
] as const;

const dos = (d: Decimal) => d.toFixed(2);

/** Normaliza un monto de BD/JSON a cadena con 2 decimales; null/vacío/no numérico ⇒ null (nunca NaN). */
export function montoDecimal(v: unknown): string | null {
  if (v == null || v === "") return null;
  try {
    const d = new Decimal(String(v));
    return d.isFinite() ? dos(d) : null;
  } catch {
    return null;
  }
}

/** Suma exacta (Decimal) de montos ya normalizados. */
export function sumaMontos(montos: (string | null | undefined)[]): string {
  return dos(montos.reduce((s, m) => (m == null ? s : s.plus(m)), new Decimal(0)));
}

/**
 * Bloque comercial. `subtotalComercial` = tarifa base + cargos VIGENTES (exacto, Decimal). Los costos internos NO son
 * parámetro de esta función: no pueden alterar el subtotal por construcción.
 */
export function construirBloqueComercial(entrada: {
  tarifaBase: unknown;
  moneda: string | null | undefined;
  cargosVigentes: CargoVigenteResumen[];
}): BloqueComercial {
  const tarifaBase = montoDecimal(entrada.tarifaBase);
  const total = sumaMontos(entrada.cargosVigentes.map((c) => c.monto));
  return {
    tarifaBase,
    moneda: entrada.moneda && entrada.moneda.trim() ? entrada.moneda.trim() : "GTQ",
    cargosAdicionales: { cantidad: entrada.cargosVigentes.length, total, items: entrada.cargosVigentes },
    subtotalComercial: tarifaBase == null ? null : dos(new Decimal(tarifaBase).plus(total)),
    tratamientoIva: "PENDIENTE",
  };
}

/** Subtotal comercial a partir de valores ya agregados (listados/reportes por lote). */
export function subtotalComercial(tarifaBase: unknown, cargosTotal: unknown): string | null {
  const base = montoDecimal(tarifaBase);
  if (base == null) return null;
  return dos(new Decimal(base).plus(montoDecimal(cargosTotal) ?? "0"));
}

/** Estado visual de la liquidación del resumen. */
export function estadoLiquidacionResumen(estado: EstadoLiquidacionViaje | null): { sujetoACambios: boolean; finalizada: boolean } {
  return { sujetoACambios: estado === "EN_AJUSTE", finalizada: estado === "LIQUIDADO" };
}

/** Compara lo congelado con lo actual (subtotal comercial); null en alguno ⇒ no comparable. */
export function difiereSnapshot(actual: string | null, congelado: string | null): boolean {
  if (actual == null || congelado == null) return false;
  return !new Decimal(actual).eq(congelado);
}

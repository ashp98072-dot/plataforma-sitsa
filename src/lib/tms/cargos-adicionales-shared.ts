import Decimal from "decimal.js";
import type { EstadoLiquidacionViaje } from "./liquidacion-viaje-shared";

/**
 * TMS — CARGOS ADICIONALES FACTURABLES (Liquidación de viajes, Fase 4). Parte PURA (sin BD).
 *
 * Tres conceptos que NUNCA se mezclan: (1) tarifa base/comercial del viaje, (2) cargos adicionales facturables al CLIENTE
 * (este módulo) y (3) costos/gastos internos (otros módulos). Un cargo NO es un gasto operativo, un viático ni una solicitud de
 * fondo.
 *
 * Tratamiento de IVA de cargos adicionales: PENDIENTE de definición de negocio/fiscal. Aquí no se suma, incluye ni excluye IVA y
 * no se genera ninguna línea de factura/FEL. Moneda: la de la tarifa del viaje (no se convierte).
 */

export const CONCEPTO_CARGO_MIN = 2;
export const CONCEPTO_CARGO_MAX = 120;
export const OBSERVACION_CARGO_MAX = 500;
export const MOTIVO_ANULACION_CARGO_MIN = 5;
export const MOTIVO_ANULACION_CARGO_MAX = 500;
export const MONTO_CARGO_MAX = "9999999999.99"; // DECIMAL(12,2)

/**
 * Sugerencias de concepto (NO restrictivas). No hay catálogo en el repositorio con estos conceptos: se evita fijar una lista
 * definitiva; el concepto es texto libre y estas opciones solo ayudan a escribirlo de forma consistente. Si negocio define un
 * catálogo administrable, se agrega `concepto_id` (nullable) sin migrar los textos existentes.
 */
export const SUGERENCIAS_CONCEPTO_CARGO = [
  "Tiempo de espera",
  "Maniobra adicional",
  "Desvío",
  "Estadía",
  "Entrega adicional",
  "Retorno",
  "Otro",
] as const;

export const TIPOS_EVENTO_CARGO = ["CREADO", "EDITADO", "ANULADO", "REACTIVADO"] as const;
export type TipoEventoCargo = (typeof TIPOS_EVENTO_CARGO)[number];

export type CargoAdicional = {
  id: number;
  planId: number;
  concepto: string;
  /** Decimal con 2 decimales, como cadena (nunca float). */
  monto: string;
  observacion: string | null;
  activo: boolean;
  version: number;
  anuladoPor: number | null;
  anuladoEn: string | null;
  motivoAnulacion: string | null;
  creadoPor: number;
  creadoEn: string;
  actualizadoPor: number | null;
  actualizadoEn: string | null;
  /** Solo en lecturas de lista/vista (JOIN a usuarios); las respuestas de mutación traen los ids. */
  creadoPorNombre?: string | null;
  actualizadoPorNombre?: string | null;
  anuladoPorNombre?: string | null;
};

export type ResumenCargosPlan = { cantidad: number; total: string; moneda?: string | null };

export type ResultadoValidacion<T> = { ok: true; valor: T } | { ok: false; error: string };

export function validarConceptoCargo(v: unknown): ResultadoValidacion<string> {
  if (typeof v !== "string") return { ok: false, error: "El concepto es obligatorio." };
  const t = v.trim().replace(/\s+/g, " ");
  if (t.length < CONCEPTO_CARGO_MIN) return { ok: false, error: `El concepto debe tener al menos ${CONCEPTO_CARGO_MIN} caracteres.` };
  if (t.length > CONCEPTO_CARGO_MAX) return { ok: false, error: `El concepto no puede superar ${CONCEPTO_CARGO_MAX} caracteres.` };
  return { ok: true, valor: t };
}

export function validarObservacionCargo(v: unknown): ResultadoValidacion<string | null> {
  if (v == null) return { ok: true, valor: null };
  if (typeof v !== "string") return { ok: false, error: "La observación no es válida." };
  const t = v.trim();
  if (!t) return { ok: true, valor: null };
  if (t.length > OBSERVACION_CARGO_MAX) return { ok: false, error: `La observación no puede superar ${OBSERVACION_CARGO_MAX} caracteres.` };
  return { ok: true, valor: t };
}

/**
 * Monto > 0 con máximo 2 decimales (NO se redondea en silencio: 10.005 se rechaza). Acepta número o cadena decimal; devuelve la
 * cadena canónica con 2 decimales. Nunca float en el resultado.
 */
export function validarMontoCargo(v: unknown): ResultadoValidacion<string> {
  if (typeof v !== "number" && typeof v !== "string") return { ok: false, error: "El monto es obligatorio." };
  const texto = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v.trim();
  if (!/^\d+(\.\d+)?$/.test(texto)) return { ok: false, error: "El monto debe ser un número positivo." };
  const d = new Decimal(texto);
  if (d.lte(0)) return { ok: false, error: "El monto debe ser mayor que cero." };
  if (d.decimalPlaces() > 2) return { ok: false, error: "El monto admite máximo 2 decimales." };
  if (d.gt(MONTO_CARGO_MAX)) return { ok: false, error: "El monto excede el máximo permitido." };
  return { ok: true, valor: d.toFixed(2) };
}

export function validarMotivoAnulacionCargo(v: unknown): ResultadoValidacion<string> {
  if (typeof v !== "string") return { ok: false, error: "El motivo es obligatorio." };
  const t = v.trim();
  if (t.length < MOTIVO_ANULACION_CARGO_MIN) return { ok: false, error: `El motivo debe tener al menos ${MOTIVO_ANULACION_CARGO_MIN} caracteres.` };
  if (t.length > MOTIVO_ANULACION_CARGO_MAX) return { ok: false, error: `El motivo no puede superar ${MOTIVO_ANULACION_CARGO_MAX} caracteres.` };
  return { ok: true, valor: t };
}

/** Suma exacta (Decimal) de los cargos ACTIVOS; los anulados no cuentan. */
export function totalCargosActivos(cargos: { monto: string; activo?: boolean }[]): string {
  return cargos.filter((c) => c.activo !== false).reduce((s, c) => s.plus(c.monto), new Decimal(0)).toFixed(2);
}

export type TotalComercialPreliminar = {
  tarifaBase: string | null;
  cargosAdicionales: string;
  /** null si el viaje no tiene tarifa: no se inventa una base. */
  totalComercial: string | null;
  /** Siempre true: el tratamiento de IVA de los cargos está pendiente; este total NO es el total de la factura. */
  ivaPendiente: true;
};

/**
 * «Total comercial preliminar» = tarifa base + cargos adicionales ACTIVOS. NO es «total factura»: no incluye IVA ni ningún
 * tratamiento fiscal, y nunca suma costos internos.
 */
export function totalComercialPreliminar(tarifaBase: string | number | null | undefined, cargos: { monto: string; activo?: boolean }[]): TotalComercialPreliminar {
  const extra = totalCargosActivos(cargos);
  const base = tarifaBase == null || tarifaBase === "" ? null : new Decimal(String(tarifaBase)).toFixed(2);
  return {
    tarifaBase: base,
    cargosAdicionales: extra,
    totalComercial: base == null ? null : new Decimal(base).plus(extra).toFixed(2),
    ivaPendiente: true,
  };
}

export type EdicionCargos = { editable: true } | { editable: false; codigo: "PLAN_NO_ADMITE" | "LIQUIDACION_CERRADA"; motivo: string };

/**
 * ¿Pueden modificarse los cargos del viaje? Los cargos son parte de la liquidación/comercial, NO de la operación física, así que
 * NO dependen de que el viaje esté abierto o cerrado:
 *   - viaje abierto no liquidado, Cerrado + REPORTE_RECIBIDO, Cerrado sin liquidación registrada y Cerrado + EN_AJUSTE: SÍ;
 *   - LIQUIDADO (incluye re-liquidado, que es LIQUIDADO con versión > 1): NO — se reabre la liquidación primero, y eso NO
 *     reabre el viaje operativo;
 *   - Cancelado: NO (un viaje cancelado no se factura; supuesto a confirmar con negocio).
 */
export function evaluarEdicionCargos(estadoPlan: string, estadoLiquidacion: EstadoLiquidacionViaje | null | undefined): EdicionCargos {
  if (estadoPlan === "Cancelado") {
    return { editable: false, codigo: "PLAN_NO_ADMITE", motivo: 'Un viaje "Cancelado" ya no admite cambios de cargos.' };
  }
  if (estadoLiquidacion === "LIQUIDADO") {
    return {
      editable: false,
      codigo: "LIQUIDACION_CERRADA",
      motivo: "El viaje está liquidado: reabre la liquidación (queda «En ajuste», el viaje sigue cerrado) para modificar sus cargos y luego liquídalo nuevamente.",
    };
  }
  return { editable: true };
}

export type ResumenCargosFila = ResumenCargosPlan & { estadoLiquidacion: EstadoLiquidacionViaje | null; editable: boolean };

/** Texto compacto de la fila de Ajustes rápidos: «Cargos: 2 · Q350.00». */
export function textoResumenCargos(r: { cantidad: number; total: string } | null | undefined, moneda: string | null = "GTQ"): string {
  const n = r?.cantidad ?? 0;
  const simbolo = !moneda || moneda === "GTQ" ? "Q" : `${moneda} `;
  const total = Number(r?.total ?? 0).toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n === 0 ? "Sin cargos" : `Cargos: ${n} · ${simbolo}${total}`;
}

import Decimal from "decimal.js";

/**
 * FACT-2 — cálculo de IVA de las líneas/totales del borrador de factura.
 *
 * Aritmética decimal (decimal.js), nunca floats: 112.00 / 1.12 se redondea
 * half-up a 2 decimales y el IVA es la DIFERENCIA (total − base), así que
 * base + IVA == total exactamente, sin céntimos perdidos.
 *
 * El total de la factura es la SUMA de los totales de línea ya redondeados
 * (nunca se recalcula el IVA sobre el gran total): lo que ve el usuario por
 * línea siempre suma exactamente al pie del documento.
 *
 * TRATAMIENTO DE IVA — decisión por LÍNEA/VIAJE (confirmado por Contabilidad): la mayoría de las tarifas YA incluyen el
 * IVA 12 %, pero hay viajes cuya tarifa lleva el IVA AGREGADO, y una MISMA factura puede mezclar ambos. Todavía no se
 * conoce la regla de negocio que decide cuál corresponde, así que NO se infiere (ni por cliente, ruta, tarifa, viaje
 * o cotización): quien factura lo elige explícitamente por viaje y se congela en
 * `fact_factura_viajes.precio_incluye_iva` junto con `porcentaje_iva`, `base_monto`, `iva_monto` y `total_linea`.
 * Aquí solo vive el porcentaje de esta fase y las fórmulas, que reciben la política por parámetro.
 */

export type PoliticaIva = { porcentajeIva: number; precioIncluyeIva: boolean };

/** IVA vigente en Guatemala para esta fase. */
export const PORCENTAJE_IVA_FASE1 = 12;

/** Política de UNA factura: el porcentaje de la fase + el tratamiento elegido explícitamente. */
export function politicaIva(precioIncluyeIva: boolean): PoliticaIva {
  return { porcentajeIva: PORCENTAJE_IVA_FASE1, precioIncluyeIva };
}

export type TotalesLinea = { base: number; iva: number; total: number };
export type TotalesFactura = { subtotal: number; iva: number; total: number };

const A_DOS_DECIMALES = (d: Decimal): Decimal => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

function aDecimal(valor: number | string, nombre: string): Decimal {
  let d: Decimal;
  try {
    d = new Decimal(valor);
  } catch {
    throw new RangeError(`${nombre} no es un número válido.`);
  }
  if (!d.isFinite()) throw new RangeError(`${nombre} no es un número válido.`);
  return d;
}

function validarPolitica(politica: PoliticaIva): Decimal {
  const pct = aDecimal(politica.porcentajeIva, "porcentajeIva");
  if (pct.isNegative() || pct.greaterThan(100)) {
    throw new RangeError("porcentajeIva debe estar entre 0 y 100.");
  }
  return pct;
}

/**
 * Desglosa UNA línea. `montoLinea` es el monto de la línea tal como se
 * captura: con IVA incluido (`precioIncluyeIva: true`) o antes de IVA (false).
 */
export function calcularTotalesLinea(input: { montoLinea: number | string } & PoliticaIva): TotalesLinea {
  const pct = validarPolitica(input);
  const monto = aDecimal(input.montoLinea, "montoLinea");
  if (monto.isNegative()) throw new RangeError("montoLinea no puede ser negativo.");

  if (input.precioIncluyeIva) {
    const total = A_DOS_DECIMALES(monto);
    const base = A_DOS_DECIMALES(total.div(pct.div(100).plus(1)));
    return { base: base.toNumber(), iva: total.minus(base).toNumber(), total: total.toNumber() };
  }
  const base = A_DOS_DECIMALES(monto);
  const iva = A_DOS_DECIMALES(base.times(pct).div(100));
  return { base: base.toNumber(), iva: iva.toNumber(), total: base.plus(iva).toNumber() };
}

export type LineaParaTotales = { montoLinea: number | string; precioIncluyeIva: boolean };

/**
 * Totales del documento = SUMA de las líneas ya desglosadas, cada una con SU PROPIA política. Nunca se recalcula el
 * IVA globalmente sobre el total agregado: subtotal = Σ base, IVA = Σ IVA de línea, total = Σ total de línea.
 */
export function calcularTotalesFactura(input: { lineas: LineaParaTotales[]; porcentajeIva: number }): TotalesFactura & { lineas: TotalesLinea[] } {
  const pct = validarPolitica({ porcentajeIva: input.porcentajeIva, precioIncluyeIva: true });
  let subtotal = new Decimal(0);
  let iva = new Decimal(0);
  let total = new Decimal(0);
  const lineas: TotalesLinea[] = [];
  for (const l of input.lineas) {
    const t = calcularTotalesLinea({ montoLinea: l.montoLinea, porcentajeIva: pct.toNumber(), precioIncluyeIva: l.precioIncluyeIva });
    lineas.push(t);
    subtotal = subtotal.plus(t.base);
    iva = iva.plus(t.iva);
    total = total.plus(t.total);
  }
  return { subtotal: subtotal.toNumber(), iva: iva.toNumber(), total: total.toNumber(), lineas };
}

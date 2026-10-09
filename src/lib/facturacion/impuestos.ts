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
 * DECISIÓN DE NEGOCIO PENDIENTE (Contabilidad): si `tarifa_comercial` /
 * `monto_asignado` incluye IVA. Históricamente en Milenium el precio incluye
 * el IVA 12 %, pero NO está confirmado para las tarifas de esta plataforma.
 * Por eso la política vive AQUÍ, en un único lugar y como dato, y los
 * cálculos la reciben por parámetro: cambiarla no toca el resto del flujo.
 */

export type PoliticaIva = { porcentajeIva: number; precioIncluyeIva: boolean };

export const POLITICA_IVA_FACTURACION: Readonly<PoliticaIva> = Object.freeze({
  porcentajeIva: 12,
  precioIncluyeIva: true,
});

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

/** Totales del documento = suma de líneas ya desglosadas (ver cabecera). */
export function calcularTotalesFactura(input: { montosLinea: (number | string)[] } & PoliticaIva): TotalesFactura {
  validarPolitica(input);
  let subtotal = new Decimal(0);
  let iva = new Decimal(0);
  let total = new Decimal(0);
  for (const montoLinea of input.montosLinea) {
    const l = calcularTotalesLinea({
      montoLinea,
      porcentajeIva: input.porcentajeIva,
      precioIncluyeIva: input.precioIncluyeIva,
    });
    subtotal = subtotal.plus(l.base);
    iva = iva.plus(l.iva);
    total = total.plus(l.total);
  }
  return { subtotal: subtotal.toNumber(), iva: iva.toNumber(), total: total.toNumber() };
}

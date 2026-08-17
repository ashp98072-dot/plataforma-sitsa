import { redondearQ } from "@/lib/rrhh/contratos-pago";

/**
 * Módulo de cálculo de ISR Mensual (Guatemala)
 * Método estándar de proyección de renta anual SAT.
 * Referencia: Decreto 10-2012 (LAT) Art. 73, Decreto 13-2026 (deducción extraordinaria 2026).
 */

export const DEDUCCION_PERSONAL_ANUAL: Record<number, number> = {
  2024: 48000,
  2025: 48000,
  2026: 48000,
  2027: 48000, // A partir de 2027 la ley cambia a 12x salario mínimo + bono; actualizar cuando SAT publique el monto.
};

export const DEDUCCION_EXTRAORDINARIA_ANUAL: Record<number, number> = {
  2024: 0,
  2025: 0,
  2026: 3024, // Decreto 13-2026, Art. 4: transitoria, solo para el ejercicio fiscal 2026.
  2027: 0,
};

export const BONIFICACION_INCENTIVO_MENSUAL = 250;
export const SALARIO_MINIMO_MENSUAL: Record<number, number> = {}; // Reservado para la reforma estructural 2027

export interface CalculoISRResult {
  rentaBrutaAnual: number;
  igssAnual: number;
  deduccionesTotales: number;
  rentaImponibleAnual: number;
  isrAnual: number;
  isrMensual: number;
}

/**
 * @param sueldoBaseMensual sueldo ordinario del mes (sí paga IGSS).
 * @param otrosIngresosGravablesMensual p.ej. bonificación incentivo: paga ISR pero NO paga IGSS.
 */
export function calcularISRDetallado(
  sueldoBaseMensual: number,
  otrosIngresosGravablesMensual: number = 0,
  anioFiscal: number = new Date().getFullYear(),
): CalculoISRResult {
  if (!Number.isFinite(sueldoBaseMensual) || sueldoBaseMensual < 0) {
    throw new Error(`sueldoBaseMensual inválido: ${sueldoBaseMensual}`);
  }
  if (!Number.isFinite(otrosIngresosGravablesMensual) || otrosIngresosGravablesMensual < 0) {
    throw new Error(`otrosIngresosGravablesMensual inválido: ${otrosIngresosGravablesMensual}`);
  }

  const cuotaIgssLaboralMensual = sueldoBaseMensual * 0.0483;
  const rentaBrutaAnual = (sueldoBaseMensual + otrosIngresosGravablesMensual) * 12;
  const igssAnual = cuotaIgssLaboralMensual * 12;

  const dedPersonal = DEDUCCION_PERSONAL_ANUAL[anioFiscal] ?? 48000;
  const dedExtra = DEDUCCION_EXTRAORDINARIA_ANUAL[anioFiscal] ?? 0;
  const deduccionesTotales = dedPersonal + dedExtra + igssAnual;

  const rentaImponibleAnual = Math.max(0, rentaBrutaAnual - deduccionesTotales);

  let isrAnual = 0;
  if (rentaImponibleAnual > 300000) {
    const excedente = rentaImponibleAnual - 300000;
    isrAnual = 15000 + excedente * 0.07;
  } else if (rentaImponibleAnual > 0) {
    isrAnual = rentaImponibleAnual * 0.05;
  }

  const isrMensual = redondearQ(isrAnual / 12);

  return { rentaBrutaAnual, igssAnual, deduccionesTotales, rentaImponibleAnual, isrAnual, isrMensual };
}

export function calcularISRMensual(
  sueldoBaseMensual: number,
  otrosIngresosGravablesMensual: number = 0,
  anioFiscal?: number,
): number {
  return calcularISRDetallado(sueldoBaseMensual, otrosIngresosGravablesMensual, anioFiscal).isrMensual;
}
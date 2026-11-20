import { z } from 'zod';

export const REGLA_VENCIMIENTO = 'MIL04A_CALENDARIO_V1';
export const plazoCredito = z.number().int().min(0).max(365);
export const fechaCredito = z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
export function calcularVencimiento(fecha: string, dias: number) {
  fechaCredito.parse(fecha); plazoCredito.parse(dias);
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  const resultado = d.toISOString().slice(0, 10);
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(resultado)) throw new Error('Vencimiento fuera de rango.');
  return resultado;
}
export const perfilCreditoSchema = z.strictObject({
  dias: plazoCredito, aprobada: z.boolean(), revision: z.number().int().min(0).max(2147483646),
  motivo: z.string().trim().min(10).max(500).refine(s => !/[\p{Cc}\p{Cf}]/u.test(s)),
});

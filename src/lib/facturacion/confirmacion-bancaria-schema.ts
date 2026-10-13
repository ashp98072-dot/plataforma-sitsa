import { z } from "zod";
import Decimal from "decimal.js";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === s;
}, "Fecha de acreditación inválida.");
export const confirmacionBancariaSchema = z.object({
  pagoId: z.number().int().positive().nullable().default(null),
  cuentaBancariaId: z.number().int().positive(),
  monto: z.string().regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/).refine((s) => new Decimal(s).gt(0), "Monto inválido."),
  fechaAcreditacion: fecha,
  referencia: z.string().trim().min(1).max(120),
  observaciones: z.string().trim().max(2000).nullable().default(null),
  idempotencyKey: z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/),
}).strict();
export type ConfirmacionBancariaInput = z.infer<typeof confirmacionBancariaSchema>;
export const anulacionBancariaSchema = z.object({ motivo: z.string().trim().min(1).max(2000) }).strict();
export const BLOQUEO_RETENCION = "La factura tiene retención y su tratamiento bancario aún no está habilitado. No se puede confirmar el ingreso hasta definir la regla de retenciones.";
export const BLOQUEO_MONEDA = "La confirmación bancaria solo está habilitada para facturas y cuentas en GTQ. No se realizan conversiones.";
export function motivoBloqueoBancario(f: { moneda: string; retencionPct: string; retencionMonto: string; estado: string; entidadId: number | null }): string | null {
  if (f.moneda !== "GTQ") return BLOQUEO_MONEDA;
  if (!new Decimal(f.retencionPct).eq(0) || !new Decimal(f.retencionMonto).eq(0)) return BLOQUEO_RETENCION;
  if (!f.entidadId) return "La factura histórica no tiene entidad emisora definida. Requiere revisión, sin backfill automático.";
  if (f.estado !== "Emitida") return "Solo se puede confirmar un ingreso contra una factura Emitida.";
  return null;
}

import { z } from "zod";

export const ESTADOS_REQUERIMIENTO_VIATICO = ["BORRADOR", "PENDIENTE", "AUTORIZADO", "RECHAZADO", "ENTREGADO", "LIQUIDADO"] as const;
export const METODOS_ENTREGA_VIATICO = ["EFECTIVO", "TRANSFERENCIA", "CHEQUE"] as const;
const id = z.number().int().positive().max(2147483647);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.");
const opcional = (max: number) => z.string().trim().max(max).nullable().optional().transform(v => v || null);
const decimal = z.union([z.string(), z.number()]).transform(String).refine(v => /^\d{1,10}(\.\d{1,2})?$/.test(v), "El monto no es válido.");

export const lineaRequerimientoViaticoSchema = z.object({
  fechaSolicitud: fecha, fechaViaje: fecha, personalId: id, vehiculoId: id.nullable().optional().transform(v => v ?? null),
  clienteId: id.nullable().optional().transform(v => v ?? null),
  cantidad: decimal.refine(v => Number(v) > 0, "La cantidad debe ser mayor que cero."),
  destino: z.string().trim().min(1, "El destino es obligatorio.").max(300),
  montoUnitario: decimal, motivoCambio: opcional(300), observaciones: opcional(10000),
}).strict();

export const guardarRequerimientoViaticoSchema = z.object({
  fechaRequerimiento: fecha, requirenteUsuarioId: id,
  observaciones: opcional(10000),
  version: id.optional(), lineas: z.array(lineaRequerimientoViaticoSchema).min(1, "Agrega al menos una línea.").max(300),
}).strict();

export const transicionRequerimientoViaticoSchema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("enviar"), version: id }).strict(),
  z.object({ accion: z.literal("autorizar"), version: id }).strict(),
  z.object({ accion: z.literal("rechazar"), version: id, motivo: z.string().trim().min(1).max(1000) }).strict(),
  z.object({ accion: z.literal("entregar"), version: id, metodo: z.enum(METODOS_ENTREGA_VIATICO), referencia: opcional(100), observaciones: opcional(1000) }).strict(),
  z.object({ accion: z.literal("liquidar"), version: id, observaciones: opcional(1000) }).strict(),
]);

export type GuardarRequerimientoViatico = z.infer<typeof guardarRequerimientoViaticoSchema>;
export type TransicionRequerimientoViatico = z.infer<typeof transicionRequerimientoViaticoSchema>;
export type RequerimientoViatico = Record<string, unknown> & { id: number; codigo: string; estado: typeof ESTADOS_REQUERIMIENTO_VIATICO[number]; total: string; lineas?: Record<string, unknown>[] };

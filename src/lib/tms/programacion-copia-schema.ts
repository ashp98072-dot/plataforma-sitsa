import { z } from "zod";
import { MAX_AUXILIARES, MAX_FILAS_LOTE } from "@/lib/tms/programacion-lote";

/**
 * TMS-PROGRAMACION-LOTE-1 (PR A) — cuerpo de validar/confirmar la copia. Esquema ESTRICTO: solo las ediciones
 * permitidas; no hay empresa_id, ni paradas, ni montos de tarifa (solo `tarifaId` del catálogo vigente).
 */
const idNullable = z.number().int().positive().nullable();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const filaEdicionSchema = z.object({
  fila: z.number().int().positive(),
  origenPlanId: idNullable,
  rutaId: idNullable,
  clienteId: idNullable,
  horaCarga: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  tipoTraslado: z.string().max(80).nullable(),
  tipoViaje: z.enum(["Propio", "Tercerizado"]),
  unidadPlaca: z.string().max(40).nullable(),
  tcVehiculoId: idNullable,
  pilotoEmpleadoId: idNullable,
  /** Piloto extra (empleado de RRHH): opcional; se revalida en el servidor con las mismas reglas que el principal. */
  pilotoExtraEmpleadoId: idNullable.optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).max(MAX_AUXILIARES),
  tarifaId: idNullable,
  externo: z.object({
    pilotoExternoNombre: z.string().max(160),
    auxiliaresExternos: z.array(z.string().max(160)).max(MAX_AUXILIARES),
    unidadExternaPlaca: z.string().max(40),
    unidadExternaDescripcion: z.string().max(160),
    transportistaExterno: z.string().max(160),
    costoTercerizado: z.number().nonnegative().nullable(),
    tcExternoPlaca: z.string().max(40),
  }).strict().nullable(),
}).strict();

export const cuerpoCopiaSchema = z.object({
  fechaOrigen: fecha,
  fechaDestino: fecha,
  filas: z.array(filaEdicionSchema).min(1).max(MAX_FILAS_LOTE),
}).strict().refine((d) => d.fechaOrigen !== d.fechaDestino, { message: "La fecha destino debe ser distinta de la fecha origen." });

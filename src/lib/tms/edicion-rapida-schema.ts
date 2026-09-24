import { z } from "zod";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-1: cuerpo de POST /tms/planes/edicion-rapida/validar. Esquema ESTRICTO: sin
 * `empresaId` (la empresa sale de la sesión) y solo los cuatro recursos que la edición rápida puede cambiar
 * (piloto, auxiliares, unidad, TC). Fecha, hora, regreso, estado, ruta, cliente, tarifa y paradas NO se cambian aquí.
 */
export const MAX_FILAS_EDICION_RAPIDA = 200;

const id = z.number().int().positive().max(2147483647);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fechaPlan inválida (YYYY-MM-DD).");
const hora = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/, "horaCarga inválida (HH:mm).");
const regreso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "regresoEstimado inválido (YYYY-MM-DDTHH:mm).");
const auxiliares = z.array(id).max(8, "Máximo 8 auxiliares por viaje.").refine((l) => new Set(l).size === l.length, "Auxiliares repetidos en la misma fila.");

/** Snapshot de concurrencia: lo que el usuario VIO al abrir la edición. Debe coincidir con la BD. */
export const esperadoSchema = z.object({
  estado: z.string().trim().min(1).max(40),
  fechaPlan: fecha,
  horaCarga: hora.nullable(),
  regresoEstimado: regreso.nullable(),
  pilotoPersonalId: id.nullable(),
  auxiliarPersonalIds: auxiliares,
  flotaVehiculoId: id.nullable(),
  tcVehiculoId: id.nullable(),
}).strict();

/** Estado FINAL propuesto de los cuatro recursos (piloto/unidad/TC nulos = quitar). El primer auxiliar es el principal. */
export const nuevoSchema = z.object({
  pilotoPersonalId: id.nullable(),
  auxiliarPersonalIds: auxiliares,
  flotaVehiculoId: id.nullable(),
  tcVehiculoId: id.nullable(),
}).strict();

export const cambioEdicionRapidaSchema = z.object({ planId: id, esperado: esperadoSchema, nuevo: nuevoSchema }).strict();

export const validarEdicionRapidaSchema = z.object({
  /** UN motivo por lote; obligatorio si hay al menos un cambio real de piloto, auxiliares, unidad o TC. */
  motivoCambio: z.string().trim().max(300).optional(),
  cambios: z.array(cambioEdicionRapidaSchema)
    .min(1, "Agrega al menos un cambio.")
    .max(MAX_FILAS_EDICION_RAPIDA, `Máximo ${MAX_FILAS_EDICION_RAPIDA} filas por lote.`)
    .refine((l) => new Set(l.map((c) => c.planId)).size === l.length, "Un mismo viaje no puede repetirse en el lote."),
}).strict();

export type ValidarEdicionRapida = z.infer<typeof validarEdicionRapidaSchema>;
export type CambioEdicionRapida = z.infer<typeof cambioEdicionRapidaSchema>;

/** Códigos estables para la futura UI. */
export type CodigoErrorEdicionRapida =
  | "PLAN_NO_ENCONTRADO"
  | "PLAN_DESACTUALIZADO"
  | "ESTADO_NO_EDITABLE"
  | "FECHA_PASADA"
  | "MOTIVO_REQUERIDO"
  | "TERCERIZADO_SIN_RECURSOS_INTERNOS"
  | "PERSONAL_INVALIDO"
  | "PERSONAL_NO_DISPONIBLE"
  | "UNIDAD_INVALIDA"
  | "TC_INVALIDO"
  | "VIATICO_PROCESADO"
  | "RECURSO_OCUPADO_BD"
  | "RECURSO_OCUPADO_LOTE";

export type ErrorFilaEdicionRapida = { codigo: CodigoErrorEdicionRapida; mensaje: string };
export type AdvertenciaFilaEdicionRapida = { tipo: string; mensaje: string };
export type EstadoFilaEdicionRapida = "ok" | "error" | "sin_cambios";
export type FilaResultadoEdicionRapida = {
  planId: number;
  estado: EstadoFilaEdicionRapida;
  errores: ErrorFilaEdicionRapida[];
  advertencias: AdvertenciaFilaEdicionRapida[];
};
export type ResultadoValidarEdicionRapida = { ok: boolean; filas: FilaResultadoEdicionRapida[] };

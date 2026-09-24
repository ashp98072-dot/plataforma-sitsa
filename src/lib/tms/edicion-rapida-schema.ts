import { z } from "zod";

/**
 * PROGRAMACIÓN — EDICIÓN RÁPIDA PR-1: cuerpo de POST /tms/planes/edicion-rapida/validar. Esquema ESTRICTO: sin
 * `empresaId` (la empresa sale de la sesión) y solo los cuatro recursos que la edición rápida puede cambiar
 * (piloto, auxiliares, unidad, TC) + (PR-355) la tarifa del catálogo y los viáticos. Fecha, hora, regreso, estado, ruta,
 * cliente y paradas NO se cambian aquí.
 */
export const MAX_FILAS_EDICION_RAPIDA = 200;

const id = z.number().int().positive().max(2147483647);
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fechaPlan inválida (YYYY-MM-DD).");
const hora = z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/, "horaCarga inválida (HH:mm).");
const regreso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "regresoEstimado inválido (YYYY-MM-DDTHH:mm).");
const auxiliares = z.array(id).max(8, "Máximo 8 auxiliares por viaje.").refine((l) => new Set(l).size === l.length, "Auxiliares repetidos en la misma fila.");

const monto = z.number().finite().min(0, "El monto no puede ser negativo.").max(9999999999.99)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "El monto admite máximo 2 decimales.");

/** Viático tal como lo vio el usuario (ids de tms_personal). El estado permite detectar viáticos ya procesados. */
export const viaticoEsperadoSchema = z.object({ personalId: id, montoAsignado: monto, estado: z.string().trim().min(1).max(20) }).strict();
/** Monto final propuesto para un viático de una persona del estado FINAL del viaje. */
export const viaticoNuevoSchema = z.object({ personalId: id, montoAsignado: monto }).strict();
const sinRepetidos = (l: { personalId: number }[]) => new Set(l.map((v) => v.personalId)).size === l.length;

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
  // PR-355 (opcionales: un cliente anterior que no los manda sigue funcionando; solo son obligatorios si `nuevo` los toca).
  tarifaId: id.nullable().optional(),
  tarifaComercial: z.number().finite().nullable().optional(),
  viaticos: z.array(viaticoEsperadoSchema).max(9).refine(sinRepetidos, "Viáticos repetidos en la misma fila.").optional(),
}).strict();

/** Estado FINAL propuesto de los cuatro recursos (piloto/unidad/TC nulos = quitar). El primer auxiliar es el principal. */
export const nuevoSchema = z.object({
  pilotoPersonalId: id.nullable(),
  auxiliarPersonalIds: auxiliares,
  flotaVehiculoId: id.nullable(),
  tcVehiculoId: id.nullable(),
  /** PR-355: tarifa del catálogo final (null = sin tarifa). Omitido = no tocar la tarifa. */
  tarifaId: id.nullable().optional(),
  /** PR-355: montos de viático EXPLÍCITAMENTE editados. Omitido = no tocar viáticos (solo se sincroniza por cambio de personal). */
  viaticos: z.array(viaticoNuevoSchema).max(9).refine(sinRepetidos, "Viáticos repetidos en la misma fila.").optional(),
}).strict();

export const cambioEdicionRapidaSchema = z.object({ planId: id, esperado: esperadoSchema, nuevo: nuevoSchema }).strict()
  .superRefine((c, ctx) => {
    if (c.nuevo.tarifaId !== undefined && (c.esperado.tarifaId === undefined || c.esperado.tarifaComercial === undefined)) {
      ctx.addIssue({ code: "custom", path: ["esperado", "tarifaId"], message: "Para cambiar la tarifa envía la tarifa esperada (tarifaId y tarifaComercial)." });
    }
    if (c.nuevo.viaticos !== undefined && c.esperado.viaticos === undefined) {
      ctx.addIssue({ code: "custom", path: ["esperado", "viaticos"], message: "Para cambiar viáticos envía los viáticos esperados." });
    }
  });

export const validarEdicionRapidaSchema = z.object({
  /** UN motivo por lote; obligatorio si hay al menos un cambio real de piloto, auxiliares, unidad, TC, tarifa o viáticos. */
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
  | "VIATICO_INVALIDO"
  | "TARIFA_INVALIDA"
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

import { z } from "zod";
import {
  LIMITE_CONDICIONES_CREDITO,
  MAX_PRECIO_COMBUSTIBLE,
  TIPOS_COMBUSTIBLE_REFERENCIA,
  esPrecioCombustibleValido,
} from "./cotizacion-documento";

/**
 * COTIZACIONES-CREDITO-COMBUSTIBLE — campos del cuerpo de POST/PATCH de cotizaciones (mismo fragmento en ambos para no
 * duplicar reglas). Opcionales e independientes: ausente = no tocar (PATCH) / sin dato (POST); null = sin dato.
 */
export const creditoCombustibleSchema = {
  condicionesCredito: z.string().max(LIMITE_CONDICIONES_CREDITO).nullable().optional(),
  combustibleReferenciaTipo: z.enum(TIPOS_COMBUSTIBLE_REFERENCIA).nullable().optional(),
  combustibleReferenciaPrecio: z
    .number()
    .positive()
    .max(MAX_PRECIO_COMBUSTIBLE)
    .refine(esPrecioCombustibleValido, "máximo 2 decimales.")
    .nullable()
    .optional(),
};

import { z } from "zod";

/**
 * RRHH-PRESTACIONES-CODIGO-CONCEPTO — catálogo único y compartido de
 * códigos fiscales estables para `rrhh_prestaciones.codigo_concepto`
 * (columna agregada en el PR #287, `varchar(40) NULL`, ya aplicada en
 * producción). Usado por POST y PATCH de
 * .../rrhh/prestaciones — nunca duplicar este arreglo en cada route.
 *
 * IMPORTANTE — esto NO es lo mismo que las claves de
 * `CONFIGURACION_CONCEPTOS_2026` (fiscal-conceptos-2026.ts): aquella
 * también incluye `SUELDO_BASE`, `HORAS_EXTRA`, `BONO_INCENTIVO` y
 * `BONO_HERRAMIENTAS`, que vienen de columnas de `empleados`/
 * `horas_extra_registros`, no de una prestación capturada manualmente
 * aquí. Los 7 códigos de abajo son el subconjunto que sí tiene sentido
 * como `codigo_concepto` de una fila de `rrhh_prestaciones`.
 *
 * Este PR SOLO valida y persiste el código — no lo conecta al motor
 * fiscal ni a Planillas (eso es un PR de integración aparte, igual que
 * ya se hizo para bono_incentivo/bono_herramientas). `OTRO` es un código
 * de captura válido, pero sigue significando fiscalmente PENDIENTE — no
 * se le da tratamiento fiscal aquí.
 */
export const CODIGOS_CONCEPTO_PRESTACION = [
  "AGUINALDO",
  "BONO_14",
  "VIATICO_COMPROBABLE",
  "VIATICO_NO_COMPROBABLE",
  "COMISION",
  "BONO_VARIABLE",
  "OTRO",
] as const;

export type CodigoConceptoPrestacion = (typeof CODIGOS_CONCEPTO_PRESTACION)[number];

/**
 * Estricto a propósito: sin `.nullable()` — para prestaciones NUEVAS el
 * código es obligatorio (la columna es nullable únicamente para no romper
 * el histórico previo a este PR, no para permitir crear registros nuevos
 * sin clasificar). PATCH lo trata como opcional envolviendo este schema
 * con `.optional()` en su propio schema, nunca con `.nullable()` — así
 * "no viene en el body" (no se toca) queda separado de "viene null"
 * (rechazado), y nunca se puede borrar un código ya asignado.
 */
export const codigoConceptoPrestacionSchema = z.enum(CODIGOS_CONCEPTO_PRESTACION);

/**
 * Etiquetas humanas para la UI — SOLO presentación. La BD/API siempre usan
 * el código estable (`codigo_concepto`); esto nunca se guarda ni se envía
 * al backend, es puramente para mostrarle algo legible a RRHH en el
 * `<select>` y en el listado. Compartido para no duplicarlo entre la
 * pantalla de creación/edición y el listado.
 */
export const ETIQUETAS_CODIGO_CONCEPTO_PRESTACION: Record<CodigoConceptoPrestacion, string> = {
  AGUINALDO: "Aguinaldo",
  BONO_14: "Bono 14",
  VIATICO_COMPROBABLE: "Viático comprobable",
  VIATICO_NO_COMPROBABLE: "Viático no comprobable",
  COMISION: "Comisión",
  BONO_VARIABLE: "Bono variable",
  OTRO: "Otro",
};

/**
 * RRHH-EXPEDIENTE-TIPO-DOCUMENTO — catálogo único y compartido de tipos de
 * documento para `documentos_empleados.tipo_documento`. Antes de este fix,
 * `documentos-modal.tsx` (frontend) mantenía su PROPIO arreglo local con
 * "Antecedentes", mientras que el backend (antes en `documentos.ts`) no lo
 * reconocía como válido (solo tenía "Antecedentes penales"/"Antecedentes
 * policíacos") — el POST hacía fallback silencioso a "Otro", así que
 * seleccionar "Antecedentes" terminaba guardándose como "Otro". Este
 * archivo NO depende de `@/lib/db` ni de ningún módulo server-only: es
 * seguro de importar tanto desde el modal ("use client") como desde
 * `documentos.ts`/la API route (server) — así nunca puede volver a haber
 * dos listas independientes que diverjan.
 */
export const TIPOS_DOCUMENTO = [
  "DPI",
  "Foto",
  "Contrato",
  "Licencia",
  "Antecedentes",
  "Antecedentes penales",
  "Antecedentes policíacos",
  "Tarjeta de pulmones",
  "Tarjeta de salud",
  "Manipulación de alimentos",
  "IGSS",
  "Boleta permiso",
  "Otro",
] as const;

export type TipoDocumentoEmpleado = (typeof TIPOS_DOCUMENTO)[number];

/**
 * Subconjunto ofrecido en el <select> del modal de "Expediente" al subir un
 * documento manualmente (mismo subconjunto que ya se mostraba antes de este
 * fix, solo que ahora agrega "Antecedentes"). Tipado contra
 * `TipoDocumentoEmpleado` para que cualquier valor aquí sea, por
 * construcción, uno de los valores válidos del catálogo único de arriba —
 * así no puede volver a ocurrir lo mismo que con "Antecedentes".
 *
 * No incluye "Foto" (tiene su propio flujo dedicado — ver
 * src/app/api/empresas/[slug]/empleados/[id]/foto/route.ts, que asume una
 * única fila con tipo_documento = 'Foto' por empleado) ni los tipos más
 * especializados (tarjetas, IGSS, boleta de permiso, "Antecedentes
 * penales"/"policíacos", etc.) — esos siguen siendo válidos para
 * históricos y para el backend, pero no se ofrecen como atajo en este
 * modal genérico, igual que antes de este fix.
 */
export const TIPOS_DOCUMENTO_SELECCIONABLES: readonly TipoDocumentoEmpleado[] = [
  "DPI",
  "Contrato",
  "Licencia",
  "Antecedentes",
  "Otro",
];

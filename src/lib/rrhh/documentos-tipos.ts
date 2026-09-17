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
  // RRHH-EXPEDIENTE-TIPO-DOCUMENTO-AMPLIAR — "Manipulación de alimentos" se
  // mantiene SOLO para lectura/compatibilidad de documentos ya guardados
  // con ese valor; las cargas nuevas usan "Tarjeta de manipulación de
  // alimentos" (ver TIPOS_DOCUMENTO_SELECCIONABLES). Cambio aditivo: no se
  // borra ni se reclasifica ningún histórico.
  "Manipulación de alimentos",
  "Tarjeta de manipulación de alimentos",
  "IGSS",
  "Boleta permiso",
  "Expediente RRHH",
  "Acuerdo de confidencialidad",
  "Certificación PRAIND",
  "Informe prueba de polígrafo",
  "Otro",
] as const;

export type TipoDocumentoEmpleado = (typeof TIPOS_DOCUMENTO)[number];

/**
 * Subconjunto ofrecido en el <select> del modal de "Expediente" al subir un
 * documento manualmente. Tipado contra `TipoDocumentoEmpleado` para que
 * cualquier valor aquí sea, por construcción, uno de los valores válidos
 * del catálogo único de arriba — así no puede volver a ocurrir lo mismo que
 * pasó con "Antecedentes" (un valor que el frontend ofrecía pero el
 * backend no reconocía).
 *
 * No incluye "Foto" (tiene su propio flujo dedicado — ver
 * src/app/api/empresas/[slug]/empleados/[id]/foto/route.ts, que asume una
 * única fila con tipo_documento = 'Foto' por empleado), ni "IGSS"/"Boleta
 * permiso"/"Manipulación de alimentos" (siguen siendo válidos para
 * históricos y para el backend, pero no se ofrecen como atajo en este
 * modal — "Manipulación de alimentos" además fue reemplazado por "Tarjeta
 * de manipulación de alimentos" para cargas nuevas).
 */
export const TIPOS_DOCUMENTO_SELECCIONABLES: readonly TipoDocumentoEmpleado[] = [
  "Tarjeta de manipulación de alimentos",
  "Tarjeta de salud",
  "Tarjeta de pulmones",
  "Antecedentes penales",
  "Antecedentes policíacos",
  "Expediente RRHH",
  "Contrato",
  "Acuerdo de confidencialidad",
  "Certificación PRAIND",
  "Informe prueba de polígrafo",
  "DPI",
  "Licencia",
  "Antecedentes",
  "Otro",
];

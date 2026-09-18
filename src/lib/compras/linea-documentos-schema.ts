/**
 * COMPRAS-FASE-3-DOCUMENTOS-LINEA — catálogo de tipos de documento de línea,
 * SIN dependencias server-only (nada de mysql2/@/lib/db/fs). Este archivo es
 * seguro de importar tanto desde `linea-documentos-client.tsx` ("use client")
 * como desde `linea-documentos.ts` (server, modelo de datos) — así el
 * bundle del navegador nunca arrastra mysql2/fs por culpa del catálogo.
 * Mismo patrón ya usado en RRHH: src/lib/rrhh/documentos-tipos.ts /
 * src/lib/uploads-constants.ts.
 */
export const TIPOS_LINEA_DOCUMENTO = [
  "FACTURA",
  "COTIZACION",
  "ORDEN_COMPRA",
  "COMPROBANTE",
  "NOTA_CREDITO",
  "OTRO",
] as const;
export type TipoLineaDocumento = (typeof TIPOS_LINEA_DOCUMENTO)[number];

export const ETIQUETAS_TIPO_LINEA_DOCUMENTO: Record<TipoLineaDocumento, string> = {
  FACTURA: "Factura",
  COTIZACION: "Cotización",
  ORDEN_COMPRA: "Orden de compra",
  COMPROBANTE: "Comprobante de pago",
  NOTA_CREDITO: "Nota de crédito",
  OTRO: "Otro",
};

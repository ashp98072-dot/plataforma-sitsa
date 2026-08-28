/**
 * VIATICOS-FIRMA — textos de UI para firma electrónica interna/simbólica,
 * en un archivo SIN dependencias de servidor (node:crypto vive en
 * firmas-internas.ts) para poder importarse también desde componentes
 * "use client". Nunca usar "Firma Electrónica Avanzada"/"certificado"/
 * "PSC"/"firma legal" en ningún texto de UI — ver FIRMA-ELECTRONICA-
 * DISENO.md §8.
 */
export const TEXTO_FIRMA_INTERNA = "Firma electrónica interna";

/**
 * RRHH-EXPEDIENTES-UPLOAD-STABILITY — constantes de validación de subida
 * de archivos, extraídas de src/lib/uploads.ts a un módulo SIN imports de
 * Node (fs/path/crypto) para que también pueda importarse desde
 * componentes "use client" (validación en el navegador ANTES de mandar
 * el POST, sección 3 del ticket) sin arrastrar esos módulos al bundle del
 * navegador. src/lib/uploads.ts re-exporta ambas constantes tal cual —
 * sigue siendo la ÚNICA fuente de verdad, ahora solo dividida en dos
 * archivos; ningún consumidor existente (15 call sites de guardarUpload)
 * cambia su import.
 */
export const EXT_PERMITIDAS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".bmp",
  ".pdf",
]);

/**
 * 50 MB — límite de la APLICACIÓN (guardarUpload lo hace cumplir server-
 * side). NO es (todavía) un límite verificado del proxy/hosting real de
 * Hostinger: no hay en este repo ninguna configuración de nginx/Passenger/
 * tamaño de request — ver DEPLOY-HOSTINGER.md y AJUSTE PRE-MERGE del
 * ticket RRHH-EXPEDIENTES-UPLOAD-STABILITY. Se mantiene sin cambios
 * porque el discovery no encontró evidencia de que 50 MB sea incorrecto
 * (ni para subirlo ni para bajarlo) — "no modificar arbitrariamente" es
 * tan válido para no tocarlo como para no inventarle un valor nuevo.
 * Pendiente: confirmar en el panel de Hostinger (o probando en
 * producción con archivos de distintos tamaños) cuál es el límite real
 * sostenible del proxy — ver el reporte final del ticket.
 */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * VIATICOS-HISTORIAL-FIRMA-1 — mapeo de etiquetas para
 * HistorialFirmasModal, extraído a un módulo puro para poder probarlo
 * con vitest (el proyecto no tiene infraestructura de pruebas de
 * componentes React — mismo criterio que viaticos-filtros-ui.ts).
 *
 * Sección 8 del ticket: nunca usar lenguaje legal/certificado ("Firma
 * Electrónica Avanzada", "certificado", "PSC") — ver TEXTO_FIRMA_INTERNA
 * en src/lib/firmas/textos.ts para el mismo criterio ya aplicado en el
 * resto del módulo.
 */

const ACCION_LABEL: Record<string, string> = {
  AUTORIZAR_VIATICO: "Autorización de viático",
  LIQUIDAR_VIATICO: "Liquidación de viático",
};

const ORIGEN_LABEL: Record<"GUARDADA" | "DIBUJADA", string> = {
  GUARDADA: "Firma guardada",
  DIBUJADA: "Dibujada en el momento",
};

const METODO_LABEL: Record<string, string> = {
  FIRMA_MANUSCRITA: "Firma manuscrita",
  PASSWORD: "Contraseña + firma",
};

/** 'AUTORIZAR_VIATICO' -> "Autorización de viático" — cae al valor crudo si algún día se agrega una acción nueva sin mapear (nunca revienta la UI). */
export function etiquetaAccion(accion: string): string {
  return ACCION_LABEL[accion] ?? accion;
}

/** GUARDADA/DIBUJADA -> etiqueta; null (payload viejo/sin imagen) -> "No disponible", nunca se inventa un origen. */
export function etiquetaOrigenFirma(origenFirma: "GUARDADA" | "DIBUJADA" | null): string {
  return origenFirma ? ORIGEN_LABEL[origenFirma] : "No disponible";
}

/** 'FIRMA_MANUSCRITA'/'PASSWORD' -> etiqueta; valor desconocido -> se muestra crudo (nunca oculta el dato real). */
export function etiquetaMetodo(metodo: string): string {
  return METODO_LABEL[metodo] ?? metodo;
}

/** "YYYY-MM-DD HH:MM:SS" (o cualquier formato que Date acepte) -> "DD/MM/YYYY HH:MM"; si no se puede parsear, devuelve el valor tal cual (nunca "Invalid Date" visible). */
export function formatearFechaFirma(fechaHoraServidor: string): string {
  const d = new Date(fechaHoraServidor);
  if (Number.isNaN(d.getTime())) return fechaHoraServidor;
  return d.toLocaleString("es-GT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Hash completo -> versión abreviada para mostrar en pantalla (los primeros 8 + los últimos 6 caracteres); hashes cortos se muestran completos. */
export function abreviarHash(hash: string): string {
  if (hash.length <= 16) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

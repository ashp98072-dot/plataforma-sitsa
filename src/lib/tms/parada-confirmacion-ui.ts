import type { ConfirmacionParada, ResultadoConfirmacion } from "./parada-confirmacion";

/**
 * TMS-ENTREGA-PILOTO-2 — parte PURA (apta para el navegador) de la confirmación de entrega por parada en el Portal del piloto:
 * etiquetas, validación de la nota y forma de los datos que el servidor entrega a la pantalla. NO importa la base de datos: lo importado de
 * parada-confirmacion.ts son solo TIPOS (se borran al compilar). La pantalla nunca decide reglas de negocio: el servidor las vuelve a validar.
 */

/** Lo que la pantalla necesita por parada de Entrega/Descarga. `evidencias` cuenta SOLO las que el servidor aceptaría para confirmar (flota_viaje_evidencias, tipo 'producto', este viaje). */
export type EntregaVista = {
  paradaId: number;
  orden: number;
  lugarNombre: string;
  tipo: string;
  evidencias: number;
  confirmacion: ConfirmacionParada | null;
};

export const RESULTADOS_CON_INCIDENCIA = ["PARCIAL", "RECHAZADA", "INCIDENCIA"] as const satisfies readonly ResultadoConfirmacion[];
export type ResultadoConIncidencia = (typeof RESULTADOS_CON_INCIDENCIA)[number];

/** Separación explícita: lo que declara el PILOTO nunca se presenta como recepción oficial de PriceSmart. */
export const ETIQUETA_RESULTADO: Record<ResultadoConfirmacion, string> = {
  ENTREGADA_POR_PILOTO: "ENTREGADA POR PILOTO",
  PARCIAL: "ENTREGA PARCIAL",
  RECHAZADA: "ENTREGA RECHAZADA",
  INCIDENCIA: "INCIDENCIA EN LA ENTREGA",
};
export const ETIQUETA_RECEPCION_OFICIAL = "Recepción oficial PriceSmart";
export const TEXTO_RECEPCION_OFICIAL = "Pendiente. La confirmación del piloto no equivale a una recepción aceptada por PriceSmart.";
export const TEXTO_REVISION_HUMANA = "En revisión por personal de Operaciones.";

export const NOTA_MIN_UI = 5;
export const NOTA_MAX_UI = 500;
export const notaValida = (nota: string) => { const n = nota.trim(); return n.length >= NOTA_MIN_UI && n.length <= NOTA_MAX_UI; };

/** «2026-11-11 10:05:00» (hora local guardada por el servidor) → «11/11/2026 10:05». Un valor no reconocido se muestra tal cual. */
export function fechaConfirmacion(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : valor;
}

/** Un nombre de usuario del portal («portal:P01») se muestra sin el prefijo técnico. */
export const usuarioVisible = (usuario: string) => usuario.replace(/^portal:/, "");

/** ¿Se puede mostrar la acción «Confirmar»? Solo sin confirmación previa de la parada, con al menos una evidencia aceptable y con permiso de piloto. */
export const puedeActuar = (e: EntregaVista, puedeConfirmar: boolean) => puedeConfirmar && e.confirmacion === null;
export const puedeEnviar = (e: EntregaVista) => e.evidencias > 0 && e.confirmacion === null;

export const rutaConfirmar = (viajeId: number, paradaId: number) => `/api/portal/viajes/${viajeId}/paradas/${paradaId}/confirmar`;

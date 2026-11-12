// PRICESMART API-13 — tipos y etiquetas (puras, sin servidor) para marcar en la bandeja de solicitudes las que nacieron de PriceSmart y las vinculaciones pendientes/fallidas.
export type PriceSmartOrigenUi = { solicitudId: number; cancelacionSolicitadaEn: string | null; cancelacionPendiente: boolean };
export type PriceSmartPendienteUi = { id: string; referencia: string; estado: "PENDIENTE" | "BLOQUEADA" | "AGOTADA"; intentos: number; ultimoResultado: string | null; ultimoDetalle: string | null; proximoIntento: string | null; reconocidoPor: string | null; reconocidoEn: string | null };
export type PriceSmartBandejaUi = { enabled: false } | { enabled: true; origen: PriceSmartOrigenUi[]; pendientes: PriceSmartPendienteUi[] };

export const ETIQUETA_VINCULACION: Record<PriceSmartPendienteUi["estado"], string> = {
  PENDIENTE: "Reintentando",
  BLOQUEADA: "Requiere revisión",
  AGOTADA: "Reintentos agotados",
};
export function claseVinculacion(estado: PriceSmartPendienteUi["estado"]): string {
  return estado === "PENDIENTE" ? "bg-amber-500/15 text-amber-500" : "bg-red-500/15 text-red-500";
}
/** Texto corto y seguro para personas; no se muestra nada que no sea un código de resultado o un mensaje de validación del TMS. */
export function textoResultadoVinculacion(p: Pick<PriceSmartPendienteUi, "ultimoResultado" | "ultimoDetalle">): string {
  const codigo = p.ultimoResultado ?? "—";
  return p.ultimoDetalle ? `${codigo}: ${p.ultimoDetalle}` : codigo;
}
/** Una vinculación necesita atención mientras nadie la haya reconocido. */
export const requiereAtencion = (p: PriceSmartPendienteUi): boolean => p.reconocidoEn == null;

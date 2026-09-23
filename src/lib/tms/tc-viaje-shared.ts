/**
 * TMS-TC-PLANES-REPORTES-1 — presentación PURA (sin BD, segura para cliente) del TC / caja / remolque
 * de un viaje. La resolución del dato (snapshot histórico primero) vive en
 * `resolverTcReporte` (reportes-viajes.ts); aquí solo se rotula.
 */
export type OrigenTc = "INTERNO" | "EXTERNO" | null | undefined;

export const ETIQUETA_TC = "TC / Caja / Remolque";

/** Origen legible: INTERNO = viaje Propio, EXTERNO = Tercerizado; sin TC = "". */
export function etiquetaOrigenTc(origen: OrigenTc): string {
  return origen === "INTERNO" ? "Propio" : origen === "EXTERNO" ? "Tercerizado" : "";
}

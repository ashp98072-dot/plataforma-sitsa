/** Vacío no es Q0: conserva el estado pendiente; el resto se valida al enviar. */
export const montoTarifaManualDesdeTexto = (texto: string): number =>
  texto.trim() === "" ? Number.NaN : Number(texto);

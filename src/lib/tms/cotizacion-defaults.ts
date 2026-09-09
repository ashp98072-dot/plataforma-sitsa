/**
 * COTIZADOR-TMS-1 — al elegir una ruta del catálogo (tms_cliente_rutas)
 * en el formulario de cotización, se SUGIERE tarifa de referencia y
 * origen/destino — nunca se sobrescribe un campo que el usuario ya haya
 * editado a mano. Mismo criterio exacto que aplicarDefaultsRutaSinSobrescribir
 * (src/lib/tms/ruta-defaults.ts, usado por Programación) — módulo
 * separado porque los campos del formulario de cotización no son los
 * mismos que los de un viaje (aquí hay origen/destino de texto libre,
 * allá hora/piloto/auxiliares).
 *
 * TMS-SIN-COSTO-OPERATIVO-1 — negocio confirmó que "costo operativo" ya
 * no se utiliza: se retiró de RutaDefaultCotizacion (antes se recibía
 * pero nunca se usaba en el resultado — dead field desde el inicio de
 * este helper).
 */

export type RutaDefaultCotizacion = {
  tarifaReferencia: number | null;
  origenTexto: string | null;
  destinoTexto: string | null;
};

export type EstadoDefaultsCotizacion = {
  tarifaCotizada: string;
  origenTexto: string;
  destinoTexto: string;
};

/** Aplica sugerencias de ruta únicamente donde el usuario aún no capturó un valor. */
export function aplicarDefaultsRutaCotizacion(
  actual: EstadoDefaultsCotizacion,
  ruta: RutaDefaultCotizacion,
): EstadoDefaultsCotizacion {
  return {
    tarifaCotizada:
      actual.tarifaCotizada === "" && ruta.tarifaReferencia != null
        ? String(ruta.tarifaReferencia)
        : actual.tarifaCotizada,
    origenTexto:
      actual.origenTexto === "" && ruta.origenTexto
        ? ruta.origenTexto
        : actual.origenTexto,
    destinoTexto:
      actual.destinoTexto === "" && ruta.destinoTexto
        ? ruta.destinoTexto
        : actual.destinoTexto,
  };
}

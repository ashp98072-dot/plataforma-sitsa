import type { Cotizacion } from "@/lib/tms/cotizaciones";
import { construirDocumentoComercial } from "./cotizacion-documento";
import { cotizacionPdfKuiqtrans } from "./cotizacion-pdf-kuiqtrans";
import { cotizacionPdfMonaco } from "./cotizacion-pdf-monaco";

/**
 * COTIZADOR-TMS-1 / FASE 6 — PDF comercial de una cotización, para enviar al
 * cliente. La plantilla (KuiqTrans o Logiservicios Mónaco) sale ÚNICAMENTE de
 * `cotizacion.documentoEmisor`, guardado en la propia cotización: no depende
 * de la empresa activa, del cliente, de la ruta ni del usuario.
 *
 * El documento se arma con `construirDocumentoComercial` a partir de la fila
 * guardada; el precio impreso es siempre `tarifaCotizada`. Solo información
 * comercial: la entrada es el tipo `Cotizacion`, que no contiene datos internos
 * de la operación.
 */
export function cotizacionPdf(c: Cotizacion): Promise<Buffer> {
  const modelo = construirDocumentoComercial(c);
  return modelo.emisor === "MONACO" ? cotizacionPdfMonaco(modelo) : cotizacionPdfKuiqtrans(modelo);
}

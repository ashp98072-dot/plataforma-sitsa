import type { Cotizacion } from "./cotizaciones";

/** Cotización completa de ejemplo para las pruebas del documento comercial (datos ficticios). */
export const COTIZACION_DOC: Cotizacion = {
  id: 123, empresaId: 7, codigo: "COT-000123", clienteId: 3, clienteNombre: "Distribuidora Ejemplo, S.A.",
  rutaId: 5, rutaCodigoHistorico: "RUTA-1", origenTexto: "Bodega Zona 12", destinoTexto: "Puerto Barrios, Izabal",
  tarifaReferencia: 1250, tarifaCotizada: 1400, incluyeIva: false, moneda: "GTQ",
  fechaEmision: "2026-09-08", fechaVencimiento: "2026-09-22", estado: "Borrador",
  pilotoIncluido: true, gpsIncluido: true, seguroMercaderiaIncluido: false, seguroTercerosIncluido: true, servicioRefrigerado: true,
  kmIncluidos: 50, tarifaKmAdicional: 12.5, condicionesAdicionales: "Pago contra entrega.\nVigencia sujeta a disponibilidad.",
  observaciones: "Cliente frecuente.", documentoEmisor: "MONACO", atencionNombre: "Claudia Cordero", atencionCargo: "Compras / Logística",
  unidadDescripcion: "Camión 5 toneladas",
  // null a propósito: ejercita el fallback determinista de MARCAS_DOCUMENTO (ver construirDocumentoComercial).
  mensajeComercial: null, cierreComercial: null,
  creadoPor: "admin", creadoEn: "2026-09-08 10:00:00", actualizadoEn: null,
  lineasAdicionales: [],
};

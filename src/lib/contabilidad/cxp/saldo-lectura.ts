import Decimal from "decimal.js";
import { desgloseFinanciero, type DesgloseFinanciero, type EstadoAdminCxp, type ImportesFactura } from "./saldo";
import type { AdvertenciaIntegridad, EstadoFinancieroFila } from "./estado-cuenta-shared";

/** Lectura explícita de datos anómalos. No se usa para autorizar ni registrar pagos. */
export type DesgloseFacturaLectura = Omit<DesgloseFinanciero, "saldo" | "estadoFinanciero"> & {
  /** Null exige revisión de integridad; nunca es saldo cero ni crédito del proveedor. */
  saldo: string | null;
  estadoFinanciero: EstadoFinancieroFila;
  excesoAplicado: string;
  advertenciasIntegridad: AdvertenciaIntegridad[];
};

export function desgloseFacturaLectura(facturaId: number, estadoAdmin: EstadoAdminCxp, factura: ImportesFactura, aplicado = "0.00"): DesgloseFacturaLectura {
  const pagadero = new Decimal(factura.totalNetoPagar), pagado = new Decimal(aplicado);
  const sobreaplicada = pagado.gt(pagadero);
  const pagoEnAnulada = estadoAdmin === "ANULADA" && pagado.gt(0);
  if (!sobreaplicada && !pagoEnAnulada) {
    return { ...desgloseFinanciero(estadoAdmin, factura, aplicado), excesoAplicado: "0.00", advertenciasIntegridad: [] };
  }
  const excesoAplicado = sobreaplicada ? pagado.minus(pagadero).toFixed(2) : "0.00";
  const advertenciasIntegridad: AdvertenciaIntegridad[] = [];
  if (sobreaplicada) advertenciasIntegridad.push({
    codigo: "SOBREAPLICACION", facturaId,
    mensaje: `Los pagos aplicados superan el monto pagadero de la factura (exceso ${excesoAplicado}). Requiere revisión de integridad; no representa saldo a favor del proveedor.`,
    detalle: { montoPagadero: pagadero.toFixed(2), pagado: pagado.toFixed(2), exceso: excesoAplicado },
  });
  if (pagoEnAnulada) advertenciasIntegridad.push({
    codigo: "PAGO_VIGENTE_EN_ANULADA", facturaId,
    mensaje: `La factura anulada conserva pagos vigentes aplicados (${pagado.toFixed(2)}). Requiere revisión de integridad.`,
    detalle: { pagado: pagado.toFixed(2) },
  });
  return {
    totalDocumento: new Decimal(factura.totalDocumento).toFixed(2), retencionIsr: new Decimal(factura.isrMonto).toFixed(2),
    montoPagadero: pagadero.toFixed(2), pagado: pagado.toFixed(2), saldo: null,
    estadoFinanciero: estadoAdmin === "ANULADA" ? "ANULADA" : "SOBREAPLICADA", excesoAplicado, advertenciasIntegridad,
  };
}

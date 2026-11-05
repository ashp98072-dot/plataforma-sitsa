import type { ExportacionIntegridad } from "../integridad-shared";
import { LIMITE_LINEAS, ROTULO_INTEGRIDAD } from "../integridad-shared";

export function datosExportacion(extra: Partial<ExportacionIntegridad> = {}): ExportacionIntegridad {
  return { entidadId: 5, filtros: {}, facturasEnAmbito: 10, facturasRevisadas: 10, totalAdvertencias: 1, facturasConAnomalias: 1,
    porCodigo: { SOBREAPLICACION: 1 }, filas: [{ entidadId: 5, facturaId: 1, proveedorId: 3, proveedor: "Proveedor QA", documento: "QA-1", estadoAdmin: "REGISTRADA",
      montoPagadero: "107.00", pagado: "107.01", excesoAplicado: "0.01", advertencia: { codigo: "SOBREAPLICACION", facturaId: 1, mensaje: "Exceso 0.01; no es saldo a favor", detalle: {} } }],
    page: 1, pageSize: 25, pagosVisibles: false, pagosDisponibles: true, limitaciones: [LIMITE_LINEAS], rotulo: ROTULO_INTEGRIDAD,
    generadoEn: "2026-11-05T18:30:00.000Z", ...extra };
}

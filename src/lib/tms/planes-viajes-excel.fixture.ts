import type { PlanReporte } from "./reportes-viajes";

/** Fixture de pruebas: un viaje cerrado y facturado con todos los campos del modelo de reporte. */
export function planFixture(over: Partial<PlanReporte> = {}): PlanReporte {
  return {
    id: 1, codigo: "PLAN-20261016-001", fechaPlan: "2026-10-16", horaCarga: "08:00:00", estado: "Cerrado", pendienteCierre: false, cerradoPor: "ops", cerradoEn: "2026-10-17 10:00:00",
    clienteId: 3, cliente: "Cliente Uno S.A.", rutaCodigo: "R-01", lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null, regresoEstimado: null,
    tarifaComercial: 1250.5, tarifaId: 4, tarifaNombre: "Tarifa 2.5 t", tarifaMontoSnapshot: 1250.5, tarifaMoneda: "GTQ", placa: "C-123ABC", unidadTipo: "Camión", unidadCapacidad: "5 t",
    vehiculoSolicitado: "Camión 2.5 toneladas", vehiculoSolicitadoPerfilId: 11, pilotoId: 9, piloto: "Juan Pérez", pilotoExtra: "Luis Gómez", auxiliares: ["Ana López", "Pedro Ruiz"],
    paradas: [], evidencias: 3, horaSalida: "2026-10-16T07:30:00", horaLlegada: "2026-10-16 18:05:00", kmSalida: 1000, kmLlegada: 1350, kmRecorridos: 350, diasRuta: 1,
    liquidacion: null, cargosAdicionales: { cantidad: 1, total: "100.00" }, subtotalComercial: "1350.50",
    estadoFacturacion: "Facturado", facturaId: 5, numeroFactura: "A-100", estadoAdminFactura: "Emitida", estadoFinancieroFactura: "Pago parcial",
    montoFacturadoViaje: 1350.5, montoBorradorViaje: null, totalFactura: 2701, totalPagadoFactura: 1000, saldoFactura: 1701,
    ...over,
  } as PlanReporte;
}

import { afterEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import {
  HEADERS_FACTURACION,
  HEADERS_OPERATIVOS,
  REPORTE_VIAJES_PDF_CONFIG,
  filaFacturacion,
  filaOperativa,
  reporteViajesHistorialPdf,
} from "./reporte-viajes-historial-pdf";
import type { KpiReporteViajes, PlanReporte } from "./reportes-viajes";

function plan(i: number): PlanReporte {
  return {
    id: i, codigo: `PLAN-${i}`, fechaPlan: "2026-09-10", horaCarga: null, estado: "Cerrado",
    pendienteCierre: false, cerradoPor: null, cerradoEn: null, clienteId: 1,
    cliente: "Cliente con un nombre suficientemente largo para comprobar el ajuste multilínea",
    rutaCodigo: "Ruta larga desde Ciudad de Guatemala hasta un destino con descripción extensa",
    lugarDescargaHistorico: null, referenciaCliente: null, tipoTraslado: null, regresoEstimado: null,
    tarifaComercial: 1250, tarifaId: null, tarifaNombre: "Tarifa histórica", tarifaMontoSnapshot: 1250,
    tarifaMoneda: "GTQ", placa: "C-001AAA", unidadTipo: "Camión", unidadCapacidad: null,
    pilotoId: 2, piloto: "Piloto con nombre y apellidos extensos", auxiliares: ["Auxiliar Primero Largo", "Auxiliar Segundo Largo"],
    paradas: [], evidencias: 4, horaSalida: "2026-09-10T08:00:00", horaLlegada: "2026-09-10T17:00:00",
    kmSalida: 100, kmLlegada: 250, kmRecorridos: 150, diasRuta: 1,
    estadoFacturacion: "Facturado", facturaId: 3, numeroFactura: "FAC-100", estadoAdminFactura: "Emitida",
    estadoFinancieroFactura: "Pago parcial", montoFacturadoViaje: 1250, montoBorradorViaje: null,
    totalFactura: 1500, totalPagadoFactura: 1000, saldoFactura: 500,
  };
}

const kpis: KpiReporteViajes = {
  totalViajes: 80, cerrados: 80, pendientesCierre: 0, enRuta: 0, cancelados: 0,
  totalEvidencias: 320, totalKmRecorridos: 12000, valorProgramado: 100000,
  valorCerrado: 100000, promedioIngresoPorViaje: 1250, viajesPendientesFacturacion: 0,
  valorPendienteFacturacion: 0, viajesFacturados: 80, valorFacturado: 100000,
  facturasPendientesCobro: 1, valorPendienteCobro: 500, cobrado: 99500,
};

afterEach(() => vi.restoreAllMocks());

describe("reporteViajesHistorialPdf", () => {
  it("usa orientación horizontal y separa las tablas operativa y financiera", () => {
    expect(REPORTE_VIAJES_PDF_CONFIG.layout).toBe("landscape");
    expect(HEADERS_OPERATIVOS).toContain("Km recorridos");
    expect(HEADERS_FACTURACION).toContain("Saldo factura");
    expect(HEADERS_OPERATIVOS).not.toContain("No. factura");
  });

  it("conserva completos los textos largos para permitir wrap", () => {
    const p = plan(1);
    expect(filaOperativa(p)).toContain(p.cliente);
    expect(filaOperativa(p)).toContain(p.rutaCodigo);
    expect(filaOperativa(p)).toContain(p.piloto);
    expect(filaOperativa(p)[6]).toContain("Auxiliar Segundo Largo");
    expect(filaFacturacion(p)).toHaveLength(HEADERS_FACTURACION.length);
  });

  it("pagina rangos extensos y repite los encabezados en páginas nuevas", async () => {
    const textos: string[] = [];
    const original = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (texto: unknown, ...args: unknown[]) {
      textos.push(String(texto));
      return original.call(this, texto as string, ...(args as []));
    });
    const buffer = await reporteViajesHistorialPdf({
      empresaNombre: "Empresa prueba", generadoEn: "10/09/2026 10:00:00",
      filtros: { fechaDesde: "2026-09-01", fechaHasta: "2026-09-30" },
      kpis, planes: Array.from({ length: 80 }, (_, i) => plan(i + 1)),
    });
    const paginas = (buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
    expect(paginas).toBeGreaterThan(2);
    expect(textos.filter((t) => t === "Fecha").length).toBeGreaterThan(1);
    expect(textos.filter((t) => t === "Código").length).toBeGreaterThan(2);
    expect(textos).toContain("1. Detalle operativo");
    expect(textos).toContain("2. Facturación / cobro");
  });
});

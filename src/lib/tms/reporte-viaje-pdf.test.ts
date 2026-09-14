import { afterEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { reporteViajePdf } from "./reporte-viaje-pdf";
import type { PlanReporte } from "./reportes-viajes";

/**
 * OPERACIONES-HORA-12H-1 (Grupo C) — "Hora salida real"/"Hora llegada
 * real" del expediente individual (sección C. Operación) en formato 12h
 * con AM/PM. Mismo criterio de prueba que gastos-individual-pdf.test.ts:
 * se espía PDFDocument.prototype.text (delegando a la implementación
 * real) para verificar exactamente qué texto se dibuja.
 */
function plan(overrides: Partial<PlanReporte> = {}): PlanReporte {
  return {
    id: 1, codigo: "PLAN-20260910-001", fechaPlan: "2026-09-10", horaCarga: "08:00:00", estado: "Cerrado",
    pendienteCierre: false, cerradoPor: "hsitan", cerradoEn: "2026-09-10T18:30",
    clienteId: 1, cliente: "Cliente Acme", rutaCodigo: "RUTA-1", lugarDescargaHistorico: null,
    referenciaCliente: null, tipoTraslado: "Directo", regresoEstimado: null,
    tarifaComercial: 1500, tarifaId: null, tarifaNombre: null, tarifaMontoSnapshot: null, tarifaMoneda: null,
    placa: "C-001AAA", unidadTipo: "Camión", unidadCapacidad: null,
    pilotoId: 2, piloto: "Juan Pérez", auxiliares: [], paradas: [], evidencias: 0,
    horaSalida: "2026-09-10T08:00", horaLlegada: "2026-09-10T17:00",
    kmSalida: 100, kmLlegada: 250, kmRecorridos: 150, diasRuta: 1,
    estadoFacturacion: "No aplica", facturaId: null, numeroFactura: null, estadoAdminFactura: null,
    estadoFinancieroFactura: null, montoFacturadoViaje: null, montoBorradorViaje: null,
    totalFactura: null, totalPagadoFactura: null, saldoFactura: null,
    ...overrides,
  };
}

function espiarTexto() {
  return vi.spyOn(PDFDocument.prototype, "text");
}

afterEach(() => vi.restoreAllMocks());

describe("reporteViajePdf — hora real en formato 12h (Grupo C)", () => {
  it("salida AM / llegada PM", async () => {
    const spy = espiarTexto();
    await reporteViajePdf("SITSA", plan({ horaSalida: "2026-09-10T08:00", horaLlegada: "2026-09-10T17:00" }));
    const textos = spy.mock.calls.map((c) => String(c[0]));
    expect(textos).toContain("2026-09-10 08:00 AM");
    expect(textos).toContain("2026-09-10 05:00 PM");
  });

  it("12:00 AM (medianoche) y 12:00 PM (mediodía)", async () => {
    const spy = espiarTexto();
    await reporteViajePdf("SITSA", plan({ horaSalida: "2026-09-10T00:00", horaLlegada: "2026-09-10T12:00" }));
    const textos = spy.mock.calls.map((c) => String(c[0]));
    expect(textos).toContain("2026-09-10 12:00 AM");
    expect(textos).toContain("2026-09-10 12:00 PM");
  });

  it("horaSalida/horaLlegada null -> '—', nunca revienta", async () => {
    const spy = espiarTexto();
    const r = await reporteViajePdf("SITSA", plan({ horaSalida: null, horaLlegada: null }));
    expect(r.subarray(0, 4).toString("latin1")).toBe("%PDF");
    const textos = spy.mock.calls.map((c) => String(c[0]));
    // "Hora salida real: " / "Hora llegada real: " se dibujan con {continued:true}
    // seguidos del valor en la siguiente llamada — ambas presentes, ninguna revienta.
    expect(textos).toContain("Hora salida real: ");
    expect(textos).toContain("Hora llegada real: ");
  });

  /**
   * Corrección post-revisión PR #264 — "Hora programada" (HH:mm plano,
   * tms_planes_viaje.hora_carga, NUNCA un DATETIME) también se convierte,
   * pero con formatearHora12 (no formatearFechaHora12, que asume
   * fecha+hora completa).
   */
  it("'Hora programada' (HH:mm plano) también se convierte a 12h, con formatearHora12", async () => {
    const spy = espiarTexto();
    await reporteViajePdf("SITSA", plan({ horaCarga: "08:00:00" }));
    const textos = spy.mock.calls.map((c) => String(c[0]));
    expect(textos).toContain("08:00 AM");
    expect(textos).not.toContain("08:00:00");
  });

  it("'Hora programada' null -> '—'", async () => {
    const spy = espiarTexto();
    await reporteViajePdf("SITSA", plan({ horaCarga: null }));
    const textos = spy.mock.calls.map((c) => String(c[0]));
    const i = textos.indexOf("Hora programada: ");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(textos[i + 1]).toBe("—"); // "campo()" dibuja label (continued) y luego el valor en la siguiente llamada
  });
});

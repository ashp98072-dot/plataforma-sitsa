import { describe, expect, it } from "vitest";
import { cantidadPaginasReporte, filaReporteDiario, totalValorViajes, type ViajeDiario } from "./reporte-diario-viajes";

const base: ViajeDiario = {
  fechaPlan: "2026-09-10", cliente: "Cliente A", unidadTipo: "Camión", placa: "C-001ABC",
  rutaCodigo: "R-01", lugarDescargaHistorico: "Destino", horaSalida: "2026-09-10T08:30",
  horaCarga: "07:00:00", piloto: "Piloto Uno", auxiliares: ["Aux Uno", "Aux Dos"],
  estado: "Cerrado", tarifaComercial: 1250,
};

describe("reporte diario de viajes", () => {
  it("usa solo datos reales y respeta el orden solicitado", () => {
    // OPERACIONES-HORA-12H-1 (Grupo C) — formato 12h con AM/PM (antes: "2026-09-10 08:30").
    expect(filaReporteDiario(base)).toEqual([
      "2026-09-10", "Cliente A", "Camión", "C-001ABC", "R-01", "2026-09-10 08:30 AM",
      "Piloto Uno", "Aux Uno", "Aux Dos", "Cerrado", "1250",
    ]);
  });

  it("muestra guion cuando faltan datos y usa hora planificada como respaldo", () => {
    expect(filaReporteDiario({ ...base, rutaCodigo: null, lugarDescargaHistorico: null, horaSalida: null, auxiliares: [], tarifaComercial: null })[4]).toBe("—");
    // OPERACIONES-HORA-12H-1 (Grupo C) — fallback a hora programada, también en 12h (antes: "07:00:00").
    expect(filaReporteDiario({ ...base, horaSalida: null })[5]).toBe("07:00 AM");
  });

  /**
   * OPERACIONES-HORA-12H-1 (Grupo C) — casos exactos pedidos: AM/PM,
   * 12:00 AM/PM, fallback hora real -> hora programada, y null total
   * (ni hora real ni programada).
   */
  describe("columna 'Hora de salida' — formato 12h (Grupo C)", () => {
    it("hora real en AM", () => {
      expect(filaReporteDiario({ ...base, horaSalida: "2026-09-10T08:30" })[5]).toBe("2026-09-10 08:30 AM");
    });

    it("hora real en PM", () => {
      expect(filaReporteDiario({ ...base, horaSalida: "2026-09-10T17:15" })[5]).toBe("2026-09-10 05:15 PM");
    });

    it("hora real 12:00 AM (medianoche)", () => {
      expect(filaReporteDiario({ ...base, horaSalida: "2026-09-10T00:00" })[5]).toBe("2026-09-10 12:00 AM");
    });

    it("hora real 12:00 PM (mediodía)", () => {
      expect(filaReporteDiario({ ...base, horaSalida: "2026-09-10T12:00" })[5]).toBe("2026-09-10 12:00 PM");
    });

    it("fallback: sin hora real, usa la hora PROGRAMADA (hora_carga, HH:mm plano) en 12h", () => {
      expect(filaReporteDiario({ ...base, horaSalida: null, horaCarga: "15:00:00" })[5]).toBe("03:00 PM");
    });

    it("ni hora real ni programada -> '—', nunca revienta", () => {
      expect(filaReporteDiario({ ...base, horaSalida: null, horaCarga: null })[5]).toBe("—");
    });

    it("con hora real presente, IGNORA la programada (la real siempre gana)", () => {
      expect(filaReporteDiario({ ...base, horaSalida: "2026-09-10T09:00", horaCarga: "07:00:00" })[5]).toBe("2026-09-10 09:00 AM");
    });
  });

  it("totaliza la tarifa histórica sin sumar viajes cancelados", () => {
    expect(totalValorViajes([base, { ...base, tarifaComercial: 250 }, { ...base, estado: "Cancelado", tarifaComercial: 999 }])).toBe(1500);
  });

  it("calcula todas las páginas necesarias cuando el rango supera 200 filas", () => {
    expect(cantidadPaginasReporte(200, 200)).toBe(1);
    expect(cantidadPaginasReporte(201, 200)).toBe(2);
    expect(cantidadPaginasReporte(1_001, 200)).toBe(6);
  });
});

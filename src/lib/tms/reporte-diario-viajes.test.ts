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
    expect(filaReporteDiario(base)).toEqual([
      "2026-09-10", "Cliente A", "Camión", "C-001ABC", "R-01", "2026-09-10 08:30",
      "Piloto Uno", "Aux Uno", "Aux Dos", "Cerrado", "1250",
    ]);
  });

  it("muestra guion cuando faltan datos y usa hora planificada como respaldo", () => {
    expect(filaReporteDiario({ ...base, rutaCodigo: null, lugarDescargaHistorico: null, horaSalida: null, auxiliares: [], tarifaComercial: null })[4]).toBe("—");
    expect(filaReporteDiario({ ...base, horaSalida: null })[5]).toBe("07:00:00");
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

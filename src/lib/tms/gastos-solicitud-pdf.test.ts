import { afterEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import { generarPdfSolicitudGastos, HEADERS_PDF_GASTOS } from "./gastos-solicitud-pdf";

function gasto(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02", planId: 2, planCodigo: "PLAN-1",
    empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto", vehiculoId: 9, placa: "P111AAA",
    clienteId: 5, clienteNombre: "Cliente A", categoria: "Combustible", descripcion: "Diesel",
    cantidad: 2, monto: 100, total: 200, metodoPago: "Transferencia móvil", numeroCuentaPago: "00123456789",
    activo: true, registradoPor: "admin", observaciones: null,
    ...overrides,
  };
}

function contarPaginas(buffer: Buffer): number {
  return (buffer.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
}

afterEach(() => vi.restoreAllMocks());

describe("generarPdfSolicitudGastos", () => {
  it("genera LETTER horizontal con título centrado, encabezado administrativo y las 10 columnas exactas", async () => {
    const textSpy = vi.spyOn(PDFDocument.prototype, "text");
    const resultado = await generarPdfSolicitudGastos({
      empresaNombre: "Transportes SITSA",
      fechaDesde: "2026-09-01",
      fechaHasta: "2026-09-30",
      filas: [gasto()],
    });

    expect(resultado.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(resultado.toString("latin1")).toMatch(/\/MediaBox\s*\[0 0 792 612\]/);
    const llamadas = textSpy.mock.calls;
    const titulo = llamadas.find((call) => call[0] === "SOLICITUD DE GASTOS");
    const opcionesTitulo = titulo?.find((arg) => typeof arg === "object" && arg !== null) as { align?: string } | undefined;
    expect(opcionesTitulo?.align).toBe("center");
    const textos = llamadas.map((call) => String(call[0]));
    expect(textos).toContain("PERÍODO: 01/09/2026 a 30/09/2026");
    expect(textos).toContain("EMPRESA REQUIRIENTE: TRANSPORTES SITSA");
    expect(HEADERS_PDF_GASTOS).toEqual([
      "Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta / Número", "Cargo",
      "Placa", "Cliente", "Cantidad", "Descripción", "Valor",
    ]);
    for (const encabezado of HEADERS_PDF_GASTOS) expect(textos).toContain(encabezado);
  });

  it("mantiene Cuenta/Número, calcula TOTAL y lo alinea a la derecha", async () => {
    const textSpy = vi.spyOn(PDFDocument.prototype, "text");
    await generarPdfSolicitudGastos({
      empresaNombre: "SITSA",
      filas: [gasto(), gasto({ id: 2, total: 350, numeroCuentaPago: null })],
    });
    const llamadas = textSpy.mock.calls;
    expect(llamadas.map((call) => String(call[0]))).toContain("00123456789");
    const total = llamadas.find((call) => call[0] === "TOTAL: Q 550.00");
    const opcionesTotal = total?.find((arg) => typeof arg === "object" && arg !== null) as { align?: string } | undefined;
    expect(opcionesTotal?.align).toBe("right");
  });

  it("pagina filas extensas y repite los encabezados de tabla en cada página", async () => {
    const textSpy = vi.spyOn(PDFDocument.prototype, "text");
    const filas = Array.from({ length: 90 }, (_, i) => gasto({
      id: i + 1,
      descripcion: `Descripción extensa del gasto operativo número ${i + 1} para comprobar el salto automático de página`,
    }));
    const resultado = await generarPdfSolicitudGastos({ empresaNombre: "SITSA", filas });
    const paginas = contarPaginas(resultado);
    expect(paginas).toBeGreaterThan(1);
    const repeticiones = textSpy.mock.calls.filter((call) => call[0] === "Fecha de solicitud").length;
    expect(repeticiones).toBe(paginas);
  });
});

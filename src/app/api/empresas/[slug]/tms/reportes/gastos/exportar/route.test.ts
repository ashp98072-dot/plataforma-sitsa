import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));
vi.mock("@/lib/tms/reportes-gastos", () => ({
  TIPOS_REPORTE_GASTOS: ["viaje", "unidad", "cliente", "categoria", "periodo", "viaticos", "rentabilidad", "fondos", "gastosDetalle"],
  filtrosReporteGastosDesdeUrl: vi.fn((url: URL) => ({
    fechaDesde: url.searchParams.get("fechaDesde") ?? undefined,
    fechaHasta: url.searchParams.get("fechaHasta") ?? undefined,
    fechaSolicitudDesde: url.searchParams.get("fechaSolicitudDesde") ?? undefined,
    fechaSolicitudHasta: url.searchParams.get("fechaSolicitudHasta") ?? undefined,
  })),
  obtenerReporteGastosPorTipo: vi.fn(),
  resumirViaticosPorEstado: vi.fn(() => ({})),
  agruparSolicitudesFondo: vi.fn((filas: unknown[]) => filas),
  resumenMensualFondos: vi.fn(() => ({ totalSolicitudes: 0, autorizadas: 0, liquidadas: 0, rechazadas: 0, pendientes: 0, totalGeneral: 0 })),
}));
vi.mock("@/lib/tms/fondos-mensual-pdf", () => ({
  generarPdfMensualSolicitudesFondo: vi.fn(() => Promise.resolve(Buffer.from("pdf-fondos-mensual"))),
}));
vi.mock("@/lib/tms/gastos-export-excel", () => ({
  exportarAgregadoGastosExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx-agregado"))),
  exportarGastosDetalleExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx-gastos"))),
  exportarRentabilidadExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx-rentabilidad"))),
  exportarReporteFondosExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx-fondos"))),
  exportarViaticosReporteExcel: vi.fn(() => Promise.resolve(Buffer.from("xlsx-viaticos"))),
}));
vi.mock("@/lib/rrhh/export-files", () => ({
  tablaAPdf: vi.fn(() => Promise.resolve(Buffer.from("pdf"))),
}));
vi.mock("@/lib/rrhh/dates", () => ({
  hoyLocal: vi.fn(() => "2026-09-09"),
  ahoraLocal: vi.fn(() => "2026-09-09 10:00:00"),
  formatearTimestampVisible: vi.fn((v: string) => v),
  formatearFechaVisible: vi.fn((v: string | null) => (v ? v.split("-").reverse().join("/") : "")),
}));

import { requireTenantGastos } from "@/lib/tenant";
import { obtenerReporteGastosPorTipo } from "@/lib/tms/reportes-gastos";
import { exportarAgregadoGastosExcel, exportarGastosDetalleExcel, exportarReporteFondosExcel, exportarViaticosReporteExcel } from "@/lib/tms/gastos-export-excel";
import { generarPdfMensualSolicitudesFondo } from "@/lib/tms/fondos-mensual-pdf";
import { tablaAPdf } from "@/lib/rrhh/export-files";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 — el export de "Reportes de gastos"
 * ahora acepta `formato=pdf` SOLO para los dos reportes de detalle
 * (viaticos/gastosDetalle); el resto de tipos (agregados/rentabilidad/
 * fondos) sigue siendo Excel únicamente, sin cambios de comportamiento.
 */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantGastos>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/reportes/gastos/exportar", () => {
  it("exige permiso antes de generar el archivo", async () => {
    vi.mocked(requireTenantGastos).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantGastos>>);
    const res = await GET(new Request("http://localhost/x?tipo=viaticos"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerReporteGastosPorTipo).not.toHaveBeenCalled();
  });

  it("tipo inválido -> 400, nunca genera nada", async () => {
    const res = await GET(new Request("http://localhost/x?tipo=inventado"), ctx);
    expect(res.status).toBe(400);
    expect(obtenerReporteGastosPorTipo).not.toHaveBeenCalled();
  });

  it("tipo=categoria (agregado) sigue exportando SOLO Excel, incluso si se pide formato=pdf", async () => {
    vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "categoria", etiqueta: "Categoría", filas: [] } as never);
    const res = await GET(new Request("http://localhost/x?tipo=categoria&formato=pdf"), ctx);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(exportarAgregadoGastosExcel).toHaveBeenCalledTimes(1);
    expect(tablaAPdf).not.toHaveBeenCalled();
  });

  describe("tipo=viaticos (§1/§4 del ticket)", () => {
    const filaViatico = {
      viaticoId: 1, fechaRegistro: "2026-09-01", fechaViaje: "2026-09-02", planId: 2, planCodigo: "PLAN-1",
      rutaDestino: "Escuintla", personalId: 3, personalNombre: "Juan Perez", cargo: "Piloto",
      cuentaBancaria: "1234567890", placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A",
      rol: "Piloto", montoSugerido: 150, montoAsignado: 150, estado: "AUTORIZADO",
      fechaAutorizacion: "2026-09-02", autorizadoPor: "hsitan", fechaEntrega: null, entregadoPor: null, observaciones: null,
    };

    it("formato=xlsx (default) reutiliza exportarViaticosReporteExcel", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "viaticos", filas: [filaViatico] } as never);
      const res = await GET(new Request("http://localhost/x?tipo=viaticos"), ctx);
      expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
      expect(exportarViaticosReporteExcel).toHaveBeenCalledWith([filaViatico]);
      expect(tablaAPdf).not.toHaveBeenCalled();
    });

    it("formato=pdf genera PDF (tablaAPdf, landscape, modo tabla) con las columnas de detalle", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "viaticos", filas: [filaViatico] } as never);
      const res = await GET(new Request("http://localhost/x?tipo=viaticos&formato=pdf"), ctx);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(tablaAPdf).toHaveBeenCalledTimes(1);
      const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
      expect(llamada.layout).toBe("landscape");
      expect(llamada.modo).toBe("tabla");
      expect(llamada.headers).toEqual(["Fecha viaje", "Código", "Nombre", "Cargo", "Cuenta", "Placa", "Cliente", "Concepto", "Monto", "Estado", "Autorizado por"]);
    });

    it("§1 del ticket — el PDF incluye una fila TOTAL GENERAL al final, con la cantidad de registros", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({
        tipo: "viaticos",
        filas: [filaViatico, { ...filaViatico, viaticoId: 2, montoAsignado: 100 }],
      } as never);
      await GET(new Request("http://localhost/x?tipo=viaticos&formato=pdf"), ctx);
      const rows = vi.mocked(tablaAPdf).mock.calls[0][0].rows;
      const filaTotal = rows.find((r) => r.includes("TOTAL GENERAL"));
      expect(filaTotal).toBeDefined();
      expect(filaTotal).toContain("2 reg.");
    });

    it("el subtítulo del PDF incluye el nombre de la empresa y el período filtrado", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "viaticos", filas: [] } as never);
      await GET(new Request("http://localhost/x?tipo=viaticos&formato=pdf&fechaDesde=2026-09-01&fechaHasta=2026-09-08"), ctx);
      const subtitulo = vi.mocked(tablaAPdf).mock.calls[0][0].subtitle;
      expect(subtitulo).toContain("SITSA");
      expect(subtitulo).toContain("01/09/2026");
      expect(subtitulo).toContain("08/09/2026");
    });
  });

  describe("tipo=gastosDetalle (§2/§4 del ticket)", () => {
    const filaGasto = {
      id: 1, fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02", planId: 2, planCodigo: "PLAN-1",
      empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto", vehiculoId: 9, placa: "P111AAA",
      clienteId: 5, clienteNombre: "Cliente A", categoria: "Combustible", descripcion: "Diesel",
      cantidad: 2, monto: 100, total: 200, activo: true, registradoPor: "admin", observaciones: null,
    };

    it("formato=xlsx reutiliza exportarGastosDetalleExcel (nunca el agregado)", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "gastosDetalle", filas: [filaGasto] } as never);
      const res = await GET(new Request("http://localhost/x?tipo=gastosDetalle"), ctx);
      expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
      expect(exportarGastosDetalleExcel).toHaveBeenCalledWith([filaGasto]);
      expect(exportarAgregadoGastosExcel).not.toHaveBeenCalled();
    });

    it("formato=pdf genera PDF de detalle, una fila por gasto (nunca agrupado)", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "gastosDetalle", filas: [filaGasto, { ...filaGasto, id: 2 }] } as never);
      const res = await GET(new Request("http://localhost/x?tipo=gastosDetalle&formato=pdf"), ctx);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
      // GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — primero las 9 columnas del ticket, luego el resto compacto.
      expect(llamada.headers).toEqual([
        "Fecha solicitud", "Fecha viaje", "Nombre", "Cargo", "Placa", "Cliente", "Cant.", "Descripción", "Total",
        "Código", "Categoría", "Estado",
      ]);
      const rows = llamada.rows;
      // 2 filas de datos + 1 fila de total = 3
      expect(rows).toHaveLength(3);
      expect(rows[rows.length - 1]).toContain("TOTAL GENERAL");
      // orden de campos de la fila: fecha solicitud primero, cargo/nombre desde el gasto.
      expect(rows[0].slice(0, 8)).toEqual(["01/09/2026", "02/09/2026", "Heber Sitan", "Piloto", "P111AAA", "Cliente A", "2", "Diesel"]);
    });
  });

  describe("tipo=fondos (REPORTES-MENSUALES-CONSOLIDADOS-1)", () => {
    const filaFondo = { lineaId: 1, solicitudId: 10, solicitudCodigo: "FONDO-000010", estadoFondo: "Autorizada", totalSolicitud: 600 };

    it("formato=xlsx (default) sigue reutilizando exportarReporteFondosExcel — sin cambios", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaFondo], resumen: {} } as never);
      const res = await GET(new Request("http://localhost/x?tipo=fondos"), ctx);
      expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
      expect(exportarReporteFondosExcel).toHaveBeenCalledWith([filaFondo]);
      expect(generarPdfMensualSolicitudesFondo).not.toHaveBeenCalled();
    });

    it("formato=pdf con un MES CALENDARIO COMPLETO (2026-09-01 a 2026-09-30) -> PDF mensual consolidado (200), nunca el Excel", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaFondo], resumen: {} } as never);
      const res = await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&fechaSolicitudDesde=2026-09-01&fechaSolicitudHasta=2026-09-30"), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      expect(res.headers.get("Content-Disposition")).toContain("solicitudes-fondo-mensual-2026-09.pdf");
      expect(exportarReporteFondosExcel).not.toHaveBeenCalled();
      const [empresaId, empresaNombre, , , periodo] = vi.mocked(generarPdfMensualSolicitudesFondo).mock.calls[0];
      expect(empresaId).toBe(7);
      expect(empresaNombre).toBe("SITSA");
      expect(periodo).toEqual({ anio: 2026, mes: 9 });
    });

    it.each([
      ["rango parcial (no empieza el día 1)", "fechaSolicitudDesde=2026-09-10&fechaSolicitudHasta=2026-09-30"],
      ["rango parcial (no termina el último día)", "fechaSolicitudDesde=2026-09-01&fechaSolicitudHasta=2026-09-15"],
      ["rango que cruza dos meses", "fechaSolicitudDesde=2026-08-15&fechaSolicitudHasta=2026-09-15"],
      ["rango de febrero incompleto (28 en año bisiesto)", "fechaSolicitudDesde=2024-02-01&fechaSolicitudHasta=2024-02-28"],
      ["sin fechas", ""],
      ["solo fecha desde", "fechaSolicitudDesde=2026-09-01"],
    ])("formato=pdf con %s -> 400 con mensaje claro, nunca genera el PDF ni corre el reporte", async (_caso, qs) => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaFondo], resumen: {} } as never);
      const res = await GET(new Request(`http://localhost/x?tipo=fondos&formato=pdf&${qs}`), ctx);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Selecciona un mes y año para generar el PDF mensual consolidado.");
      expect(generarPdfMensualSolicitudesFondo).not.toHaveBeenCalled();
      expect(obtenerReporteGastosPorTipo).not.toHaveBeenCalled();
    });

    it("un mes de 31 días también es válido (2026-01-01 a 2026-01-31)", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaFondo], resumen: {} } as never);
      const res = await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&fechaSolicitudDesde=2026-01-01&fechaSolicitudHasta=2026-01-31"), ctx);
      expect(res.status).toBe(200);
      const [, , , , periodo] = vi.mocked(generarPdfMensualSolicitudesFondo).mock.calls[0];
      expect(periodo).toEqual({ anio: 2026, mes: 1 });
    });

    it("febrero completo en año bisiesto (2024-02-01 a 2024-02-29) es válido", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaFondo], resumen: {} } as never);
      const res = await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&fechaSolicitudDesde=2024-02-01&fechaSolicitudHasta=2024-02-29"), ctx);
      expect(res.status).toBe(200);
    });
  });
});

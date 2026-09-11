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

  describe("tipo=gastosDetalle (§2/§4 del ticket; FONDOS-GASTOS-METODO-PAGO-1)", () => {
    const filaGasto = {
      id: 1, fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02", planId: 2, planCodigo: "PLAN-1",
      empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto", vehiculoId: 9, placa: "P111AAA",
      clienteId: 5, clienteNombre: "Cliente A", categoria: "Combustible", descripcion: "Diesel",
      cantidad: 2, monto: 100, total: 200, metodoPago: "Transferencia móvil", numeroCuentaPago: "55551234",
      activo: true, registradoPor: "admin", observaciones: null,
    };

    it("formato=xlsx reutiliza exportarGastosDetalleExcel (nunca el agregado) — sin cambios", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "gastosDetalle", filas: [filaGasto] } as never);
      const res = await GET(new Request("http://localhost/x?tipo=gastosDetalle"), ctx);
      expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
      expect(exportarGastosDetalleExcel).toHaveBeenCalledWith([filaGasto]);
      expect(exportarAgregadoGastosExcel).not.toHaveBeenCalled();
    });

    /**
     * FONDOS-GASTOS-METODO-PAGO-1 — reemplaza el formato de 12 columnas
     * (que incluía Código/Categoría/Estado) por las 10 EXACTAS acordadas,
     * con "Cuenta / Número" como encabezado FIJO (nunca dinámico, porque
     * el reporte puede mezclar registros con distintos métodos de pago).
     */
    it("formato=pdf genera el PDF tabular simplificado (10 columnas), una fila por gasto (nunca agrupado)", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "gastosDetalle", filas: [filaGasto, { ...filaGasto, id: 2 }] } as never);
      const res = await GET(new Request("http://localhost/x?tipo=gastosDetalle&formato=pdf"), ctx);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
      const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
      expect(llamada.headers).toEqual([
        "Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta / Número", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Valor",
      ]);
      const rows = llamada.rows;
      // 2 filas de datos + 1 fila de total = 3
      expect(rows).toHaveLength(3);
      expect(rows[rows.length - 1]).toContain("TOTAL:");
      expect(rows[rows.length - 1]).toContain("Q400.00"); // 200 + 200
      // orden de campos de la fila: fecha solicitud, fecha viaje, nombre, Cuenta/Número (numeroCuentaPago), cargo...
      expect(rows[0]).toEqual(["01/09/2026", "02/09/2026", "Heber Sitan", "55551234", "Piloto", "P111AAA", "Cliente A", "2", "Diesel", "Q200.00"]);
    });

    it("el PDF muestra EMPRESA REQUIRIENTE (sin PERSONA QUE REQUIERE — Gastos no tiene ese concepto)", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "gastosDetalle", filas: [filaGasto] } as never);
      await GET(new Request("http://localhost/x?tipo=gastosDetalle&formato=pdf"), ctx);
      const subtitulo = vi.mocked(tablaAPdf).mock.calls[0][0].subtitle;
      expect(subtitulo).toContain("EMPRESA REQUIRIENTE: SITSA");
      expect(subtitulo).not.toContain("PERSONA QUE REQUIERE");
    });

    it("un registro con Cuenta bancaria normal (no Transferencia móvil) también cae en la misma columna", async () => {
      vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({
        tipo: "gastosDetalle",
        filas: [{ ...filaGasto, metodoPago: "Efectivo", numeroCuentaPago: null }],
      } as never);
      await GET(new Request("http://localhost/x?tipo=gastosDetalle&formato=pdf"), ctx);
      const fila = vi.mocked(tablaAPdf).mock.calls[0][0].rows[0]!;
      expect(fila[3]).toBe("—"); // sin cuenta/número -> "—", mismo criterio que el resto de columnas opcionales
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

    /**
     * REPORTES-FONDOS-PDF-TABULAR-1 — `variante=tabular` es un PDF
     * DISTINTO al mensual consolidado: mismo tipo/endpoint, mismos
     * filtros/consulta ya cargados, pero SIN exigir mes completo, SIN
     * firmas ni RESUMEN DEL MES — el equivalente compacto al PDF de
     * Gastos operativos.
     */
    describe("variante=tabular (REPORTES-FONDOS-PDF-TABULAR-1)", () => {
      const filaDetalle = {
        lineaId: 1, solicitudId: 10, solicitudCodigo: "FONDO-000010", estadoFondo: "Pendiente",
        fechaSolicitud: "2026-09-05", fechaViaje: "2026-09-06",
        entidadRequirenteNombre: "Kuiqtrans", requirenteNombre: "Wilter Flores", empleadoNombre: "Heber Sitan", cargo: "Piloto", cuenta: "1234567890",
        placa: "P111AAA", clienteNombre: "Cliente A", cantidad: 2, descripcion: "Combustible ruta",
        monto: 100, total: 200,
      };

      it("con un RANGO LIBRE (sin mes completo) -> 200, PDF tabular (nunca 400, nunca exige mes)", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaDetalle], resumen: {} } as never);
        const res = await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular&fechaSolicitudDesde=2026-09-10&fechaSolicitudHasta=2026-09-15"), ctx);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toBe("application/pdf");
        expect(res.headers.get("Content-Disposition")).toContain("reporte-solicitudes-fondo-2026-09-09.pdf");
        expect(generarPdfMensualSolicitudesFondo).not.toHaveBeenCalled();
      });

      it("SIN ningún filtro de fecha -> también 200 (nunca exige mes, a diferencia del mensual)", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaDetalle], resumen: {} } as never);
        const res = await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
        expect(res.status).toBe(200);
      });

      /**
       * FONDOS-GASTOS-METODO-PAGO-1 — reemplaza el formato de 12 columnas
       * (Código/Estado/Requirente) por las 10 EXACTAS acordadas; "Cuenta /
       * Número" es un encabezado FIJO (nunca dinámico).
       */
      it("las columnas son las 10 EXACTAS acordadas (fecha solicitud, fecha viaje, nombre, Cuenta/Número, cargo, placa, cliente, cantidad, descripción, valor)", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaDetalle], resumen: {} } as never);
        await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
        const llamada = vi.mocked(tablaAPdf).mock.calls[0][0];
        expect(llamada.headers).toEqual([
          "Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta / Número", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Valor",
        ]);
        expect(llamada.layout).toBe("landscape");
        expect(llamada.modo).toBe("tabla");
        expect(llamada.weight).toBeDefined();
        const filaDatos = llamada.rows[0]!;
        expect(filaDatos).toEqual(["05/09/2026", "06/09/2026", "Heber Sitan", "1234567890", "Piloto", "P111AAA", "Cliente A", "2", "Combustible ruta", "Q200.00"]);
      });

      it("incluye una fila final TOTAL: con la suma de todas las líneas del filtro (nunca solo Excel)", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({
          tipo: "fondos",
          filas: [filaDetalle, { ...filaDetalle, lineaId: 2, solicitudId: 11, solicitudCodigo: "FONDO-000011", total: 350 }],
          resumen: {},
        } as never);
        await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
        const rows = vi.mocked(tablaAPdf).mock.calls[0][0].rows;
        expect(rows).toHaveLength(3); // 2 líneas + total
        const filaTotal = rows[rows.length - 1]!;
        expect(filaTotal).toContain("TOTAL:");
        expect(filaTotal).toContain("Q550.00");
      });

      describe("encabezado EMPRESA REQUIRIENTE / PERSONA QUE REQUIERE", () => {
        it("muestra el nombre de la empresa y, si todas las filas comparten requirente, su nombre", async () => {
          vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({
            tipo: "fondos",
            filas: [filaDetalle, { ...filaDetalle, lineaId: 2 }], // mismo requirenteNombre
            resumen: {},
          } as never);
          await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
          const subtitulo = vi.mocked(tablaAPdf).mock.calls[0][0].subtitle;
          expect(subtitulo).toContain("EMPRESA REQUIRIENTE: KUIQTRANS");
          expect(subtitulo).toContain("PERSONA QUE REQUIERE: WILTER FLORES");
        });

        it("muestra VARIOS REQUIRIENTES cuando las filas filtradas tienen requirentes distintos", async () => {
          vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({
            tipo: "fondos",
            filas: [filaDetalle, { ...filaDetalle, lineaId: 2, requirenteNombre: "Otro Requirente" }],
            resumen: {},
          } as never);
          await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
          const subtitulo = vi.mocked(tablaAPdf).mock.calls[0][0].subtitle;
          expect(subtitulo).toContain("PERSONA QUE REQUIERE: VARIOS REQUIRIENTES");
        });

        it("muestra VARIAS EMPRESAS REQUIRIENTES cuando el rango contiene entidades distintas", async () => {
          vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({
            tipo: "fondos",
            filas: [filaDetalle, { ...filaDetalle, lineaId: 2, entidadRequirenteNombre: "Logiservicios Mónaco" }],
            resumen: {},
          } as never);
          await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
          const subtitulo = vi.mocked(tablaAPdf).mock.calls[0][0].subtitle;
          expect(subtitulo).toContain("EMPRESA REQUIRIENTE: VARIAS EMPRESAS REQUIRIENTES");
        });

        it("muestra VARIOS REQUIRIENTES cuando ninguna fila tiene requirente (sin inventar un nombre)", async () => {
          vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({
            tipo: "fondos",
            filas: [{ ...filaDetalle, requirenteNombre: null }],
            resumen: {},
          } as never);
          await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
          const subtitulo = vi.mocked(tablaAPdf).mock.calls[0][0].subtitle;
          expect(subtitulo).toContain("PERSONA QUE REQUIERE: VARIOS REQUIRIENTES");
        });
      });

      it("respeta el filtro Requirente/Estado ya calculado por el mismo reporte (nunca un segundo parseo)", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaDetalle], resumen: {} } as never);
        await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular&estadoFondo=Pendiente&requirenteUsuarioId=9"), ctx);
        // obtenerReporteGastosPorTipo ya recibe filtrosReporteGastosDesdeUrl(url) — mismo objeto que el Excel/mensual, sin bifurcar.
        expect(obtenerReporteGastosPorTipo).toHaveBeenCalledTimes(1);
        expect(exportarReporteFondosExcel).not.toHaveBeenCalled();
      });

      it("nunca usa Excel ni el generador mensual con firmas para esta variante", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaDetalle], resumen: {} } as never);
        await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular"), ctx);
        expect(exportarReporteFondosExcel).not.toHaveBeenCalled();
        expect(generarPdfMensualSolicitudesFondo).not.toHaveBeenCalled();
      });

      it("cualquier otro valor de `variante` (o su ausencia) conserva el PDF mensual consolidado sin cambios", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaFondo], resumen: {} } as never);
        const res = await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=otra-cosa&fechaSolicitudDesde=2026-09-01&fechaSolicitudHasta=2026-09-30"), ctx);
        expect(res.status).toBe(200);
        expect(generarPdfMensualSolicitudesFondo).toHaveBeenCalledTimes(1);
      });

      it("variante=tabular con un rango PARCIAL sigue funcionando (nunca el 400 del mensual)", async () => {
        vi.mocked(obtenerReporteGastosPorTipo).mockResolvedValue({ tipo: "fondos", filas: [filaDetalle], resumen: {} } as never);
        const res = await GET(new Request("http://localhost/x?tipo=fondos&formato=pdf&variante=tabular&fechaSolicitudDesde=2026-09-10&fechaSolicitudHasta=2026-09-15"), ctx);
        expect(res.status).toBe(200);
        const body = res.status === 400 ? await res.json() : null;
        expect(body).toBeNull();
      });
    });
  });
});

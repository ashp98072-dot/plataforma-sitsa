import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  exportarAgregadoGastosExcel,
  exportarRentabilidadExcel,
  exportarSolicitudFondoExcel,
  exportarViaticosReporteExcel,
} from "./gastos-export-excel";
import type { SolicitudFondo } from "./fondos";

async function primeraHoja(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb.worksheets[0]!;
}

describe("exportación Excel de reportes de gastos", () => {
  it("agregado (por categoría/unidad/cliente/etc.) incluye encabezados y filas", async () => {
    const buf = await exportarAgregadoGastosExcel("Gastos por categoría", "Categoría", [
      { clave: "Combustible", etiqueta: "Combustible", registros: 3, totalMonto: 1350 },
    ]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(1).values).toEqual([undefined, "Categoría", "Registros", "Total (Q)"]);
    expect(ws.getRow(2).values).toEqual([undefined, "Combustible", "3", "1350.00"]);
  });

  it("viáticos por viaje/empleado", async () => {
    const buf = await exportarViaticosReporteExcel([{
      viaticoId: 1, planId: 2, planCodigo: "PLAN-1", fechaPlan: "2026-09-01",
      personalId: 3, personalNombre: "Juan Perez", rol: "Piloto", montoSugerido: 150, montoAsignado: 150, estado: "PROGRAMADO",
    }]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(2).values).toEqual([undefined, "PLAN-1", "2026-09-01", "Juan Perez", "Piloto", "150.00", "150.00", "PROGRAMADO"]);
  });

  it("rentabilidad por viaje muestra '—' cuando no hay costo operativo capturado", async () => {
    const buf = await exportarRentabilidadExcel([{
      planId: 1, planCodigo: "PLAN-1", fechaPlan: "2026-09-01", clienteNombre: null,
      tarifaComercial: 1000, costoOperativo: null, gastos: 0, viaticos: 0, utilidad: 1000,
    }]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(2).values).toEqual([undefined, "PLAN-1", "2026-09-01", "—", "1000.00", "—", "0.00", "0.00", "1000.00"]);
  });

  it("solicitud de fondo incluye líneas y fila de total", async () => {
    const solicitud: SolicitudFondo = {
      id: 1, empresaId: 7, codigo: "FONDO-000001", requirenteEmpleadoId: null, requirenteNombre: "Juan Perez",
      fechaRequerimiento: "2026-09-01", total: 350, autorizanteEmpleadoId: null, autorizanteNombre: null,
      estado: "Pendiente", autorizadoEn: null, rechazadoEn: null, motivoRechazo: null, liquidadoEn: null,
      observaciones: null, creadoPor: "admin", creadoEn: "2026-09-01 10:00:00",
      lineas: [
        { id: 1, categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, orden: 0 },
        { id: 2, categoria: "Hospedaje", descripcion: null, cantidad: 1, monto: 150, orden: 1 },
      ],
    };
    const buf = await exportarSolicitudFondoExcel(solicitud);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(2).values).toEqual([undefined, "Combustible", "Diesel", "2", "100.00", "200.00"]);
    expect(ws.getRow(4).values).toEqual([undefined, "", "", "", "TOTAL", "350.00"]);
  });
});

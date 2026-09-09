import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  exportarAgregadoGastosExcel,
  exportarGastosDetalleExcel,
  exportarRentabilidadExcel,
  exportarReporteFondosExcel,
  exportarSolicitudFondoExcel,
  exportarViaticosReporteExcel,
} from "./gastos-export-excel";
import type { SolicitudFondo } from "./fondos";
import type { FilaGastoDetalle, FilaSolicitudFondoReporte, FilaViaticoReporte } from "./reportes-gastos";

function filaViatico(overrides: Partial<FilaViaticoReporte> = {}): FilaViaticoReporte {
  return {
    viaticoId: 1, fechaRegistro: "2026-09-01", fechaViaje: "2026-09-02",
    planId: 2, planCodigo: "PLAN-1", rutaDestino: "Escuintla",
    personalId: 3, personalNombre: "Juan Perez", cargo: "Piloto", cuentaBancaria: "1234567890",
    placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A", rol: "Piloto",
    montoSugerido: 150, montoAsignado: 150, estado: "AUTORIZADO",
    fechaAutorizacion: "2026-09-02", autorizadoPor: "hsitan",
    fechaEntrega: null, entregadoPor: null, observaciones: null,
    ...overrides,
  };
}

function filaGasto(overrides: Partial<FilaGastoDetalle> = {}): FilaGastoDetalle {
  return {
    id: 1, fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02",
    planId: 2, planCodigo: "PLAN-1", empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto",
    vehiculoId: 9, placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A",
    categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, total: 200,
    activo: true, registradoPor: "admin", observaciones: null,
    ...overrides,
  };
}

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

  it("viáticos — detalle completo por registro, con cuenta bancaria/placa/cliente/ruta/autorización", async () => {
    const buf = await exportarViaticosReporteExcel([filaViatico()]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(1).values).toEqual([
      undefined, "Fecha registro", "Fecha viaje", "Código viaje", "Ruta / destino",
      "Nombre", "Cargo", "Cuenta bancaria", "Placa", "Cliente", "Concepto",
      "Monto sugerido", "Monto asignado", "Estado",
      "Fecha autorización", "Autorizado por", "Fecha entrega", "Entregado por", "Observaciones",
    ]);
    expect(ws.getRow(2).values).toEqual([
      undefined, "01/09/2026", "02/09/2026", "PLAN-1", "Escuintla",
      "Juan Perez", "Piloto", "1234567890", "P111AAA", "Cliente A", "Piloto",
      150, 150, "AUTORIZADO", "02/09/2026", "hsitan", "—", "—", "—",
    ]);
  });

  it("viáticos — al final agrega TOTAL GENERAL y un total por cada estado presente", async () => {
    const buf = await exportarViaticosReporteExcel([
      filaViatico({ viaticoId: 1, montoAsignado: 150, estado: "AUTORIZADO" }),
      filaViatico({ viaticoId: 2, montoAsignado: 100, estado: "LIQUIDADO" }),
    ]);
    const ws = await primeraHoja(buf);
    // filas 2/3 = datos, fila 4 = blank, fila 5 = TOTAL GENERAL, filas 6/7 = por estado
    expect(ws.getRow(5).getCell(10).value).toBe("TOTAL GENERAL");
    expect(ws.getRow(5).getCell(12).value).toBe(250);
    expect(ws.getRow(5).getCell(13).value).toBe("2 registro(s)");
    const filasEstado = [ws.getRow(6).getCell(10).value, ws.getRow(7).getCell(10).value];
    expect(filasEstado).toEqual(expect.arrayContaining(["Total AUTORIZADO", "Total LIQUIDADO"]));
  });

  it("gastos operativos — detalle por registro, nunca agrupado", async () => {
    const buf = await exportarGastosDetalleExcel([filaGasto(), filaGasto({ id: 2, activo: false })]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(1).values).toEqual([
      undefined, "Fecha", "Fecha de viaje", "Código viaje", "Empleado / beneficiario", "Cargo", "Placa", "Cliente",
      "Categoría", "Descripción", "Cantidad", "Monto unitario", "Total", "Estado", "Registrado por", "Observaciones",
    ]);
    expect(ws.getRow(2).values).toEqual([
      undefined, "01/09/2026", "02/09/2026", "PLAN-1", "Heber Sitan", "Piloto", "P111AAA", "Cliente A",
      "Combustible", "Diesel", 2, 100, 200, "Activo", "admin", "—",
    ]);
    expect(ws.getRow(3).getCell(13).value).toBe("Anulado");
    // fila 4 = blank, fila 5 = TOTAL GENERAL
    expect(ws.getRow(5).getCell(9).value).toBe("TOTAL GENERAL");
    expect(ws.getRow(5).getCell(12).value).toBe(400);
    expect(ws.getRow(5).getCell(13).value).toBe("2 registro(s)");
  });

  it("rentabilidad por viaje: tarifa, gastos, viáticos y utilidad separados (sin costo operativo, TMS-SIN-COSTO-OPERATIVO-1)", async () => {
    const buf = await exportarRentabilidadExcel([{
      planId: 1, planCodigo: "PLAN-1", fechaPlan: "2026-09-01", clienteNombre: null,
      tarifaComercial: 1000, gastos: 0, viaticos: 0, utilidad: 1000,
    }]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(1).values).toEqual([
      undefined, "Viaje", "Fecha", "Cliente", "Tarifario (Q)", "Gastos (Q)", "Viaticos (Q)", "Utilidad (Q)",
    ]);
    expect(ws.getRow(1).values).not.toContain("Costo operativo (Q)");
    expect(ws.getRow(2).values).toEqual([undefined, "PLAN-1", "2026-09-01", "—", "1000.00", "0.00", "0.00", "1000.00"]);
  });

  it("solicitud de fondo incluye líneas y fila de total", async () => {
    const solicitud: SolicitudFondo = {
      id: 1, empresaId: 7, codigo: "FONDO-000001", requirenteEmpleadoId: null, requirenteNombre: "Juan Perez", requirenteUsuarioId: null,
      fechaRequerimiento: "2026-09-01", total: 350, autorizanteEmpleadoId: null, autorizanteNombre: null, autorizanteUsuarioId: null,
      estado: "Pendiente", autorizadoEn: null, rechazadoEn: null, motivoRechazo: null, liquidadoEn: null,
      observaciones: null, creadoPor: "admin", solicitanteUsuarioId: null, solicitanteNombre: null, creadoEn: "2026-09-01 10:00:00",
      lineas: [
        {
          id: 1, categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, orden: 0,
          fechaViaje: null, empleadoId: null, empleadoNombre: null, cargo: null, cuenta: null,
          vehiculoId: null, placa: null, clienteId: null, clienteNombre: null, planId: null,
        },
        {
          id: 2, categoria: "Hospedaje", descripcion: null, cantidad: 1, monto: 150, orden: 1,
          fechaViaje: null, empleadoId: null, empleadoNombre: null, cargo: null, cuenta: null,
          vehiculoId: null, placa: null, clienteId: null, clienteNombre: null, planId: null,
        },
      ],
    };
    const buf = await exportarSolicitudFondoExcel(solicitud);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(1).values).toEqual([undefined, "Fecha solicitud", "Fecha viaje", "Nombre", "Cuenta", "Cargo", "Placa", "Cliente", "Categoría", "Cantidad", "Descripción", "Valor", "Subtotal (Q)"]);
    expect(ws.getRow(2).values).toEqual([undefined, "01/09/2026", "", "", "", "", "", "", "Combustible", "2", "Diesel", "100.00", "200.00"]);
    expect(ws.getRow(4).values).toEqual([undefined, "", "", "", "", "", "", "", "", "", "", "TOTAL", "350.00"]);
  });
});

/**
 * SOLICITUD-FONDOS-REPORTE-1 — Excel del REPORTE de solicitudes de fondo
 * (filas ya filtradas por reporteSolicitudesFondo): exactamente las 9
 * columnas pedidas, sin ids internos, con formato dd/mm/yyyy, GTQ,
 * autofiltro y anchos legibles.
 */
describe("exportarReporteFondosExcel (SOLICITUD-FONDOS-REPORTE-1)", () => {
  function fila(overrides: Partial<FilaSolicitudFondoReporte> = {}): FilaSolicitudFondoReporte {
    return {
      lineaId: 1, solicitudId: 10, solicitudCodigo: "FONDO-000010",
      fechaSolicitud: "2026-09-01", fechaViaje: "2026-09-02",
      empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto",
      vehiculoId: 9, placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A",
      planId: 8, cantidad: 2, descripcion: "Viáticos de ruta", monto: 100, total: 200,
      cuenta: "123-456", requirenteNombre: "Requirente", solicitanteNombre: "Solicitante", autorizanteNombre: "Autorizante",
      fechaAutorizacion: "2026-09-03", totalSolicitud: 200,
      estadoFondo: "Autorizada",
      ...overrides,
    };
  }

  it("encabezados EXACTOS pedidos por el ticket, en orden, sin ids internos", async () => {
    const buf = await exportarReporteFondosExcel([fila()]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(1).values).toEqual([
      undefined, "Código solicitud", "Estado", "Fecha solicitud", "Fecha viaje", "Nombre", "Cuenta", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Monto unitario", "Total línea", "Requirente", "Solicitante", "Autorizante", "Fecha autorización", "Total solicitud",
    ]);
  });

  it("fechas visibles dd/mm/yyyy, Total en GTQ (numFmt), Cantidad numérica — mismas filas que el filtro, sin ids", async () => {
    const buf = await exportarReporteFondosExcel([fila()]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(2).values).toEqual([
      undefined, "FONDO-000010", "Autorizada", "01/09/2026", "02/09/2026", "Heber Sitan", "123-456", "Piloto", "P111AAA", "Cliente A", 2, "Viáticos de ruta", 100, 200, "Requirente", "Solicitante", "Autorizante", "03/09/2026", 200,
    ]);
    expect(ws.getColumn(13).numFmt).toContain("Q");
    expect(ws.getColumn(10).numFmt).toBe("0.00");
  });

  it("línea sin fecha de viaje (nunca ligada a un viaje) muestra '—', no revienta ni inventa una fecha", async () => {
    const buf = await exportarReporteFondosExcel([fila({ fechaViaje: null, empleadoNombre: null, cargo: null, placa: null, clienteNombre: null })]);
    const ws = await primeraHoja(buf);
    expect(ws.getRow(2).values).toEqual([
      undefined, "FONDO-000010", "Autorizada", "01/09/2026", "—", "—", "123-456", "—", "—", "—", 2, "Viáticos de ruta", 100, 200, "Requirente", "Solicitante", "Autorizante", "03/09/2026", 200,
    ]);
  });

  it("exporta EXACTAMENTE las filas recibidas (mismo conjunto que el filtro activo) — ni más, ni menos", async () => {
    const filas = [fila({ lineaId: 1 }), fila({ lineaId: 2, empleadoNombre: "Otra Persona" })];
    const buf = await exportarReporteFondosExcel(filas);
    const ws = await primeraHoja(buf);
    expect(ws.rowCount).toBe(3); // encabezado + 2 filas, ni una fila extra ni una de menos
    expect(ws.getRow(3).getCell(5).value).toBe("Otra Persona");
  });

  it("incluye autofiltro cubriendo encabezado y todas las filas", async () => {
    const buf = await exportarReporteFondosExcel([fila(), fila({ lineaId: 2 })]);
    const ws = await primeraHoja(buf);
    expect(ws.autoFilter).toEqual("A1:R3");
  });

  it("nunca incluye columnas de ids internos (lineaId/solicitudId/empleadoId/vehiculoId/clienteId/planId)", async () => {
    const buf = await exportarReporteFondosExcel([fila()]);
    const ws = await primeraHoja(buf);
    const encabezados = (ws.getRow(1).values as unknown[]).filter(Boolean).map(String);
    for (const columnaProhibida of ["lineaId", "solicitudId", "empleadoId", "vehiculoId", "clienteId", "planId", "Id"]) {
      expect(encabezados.join(" ")).not.toContain(columnaProhibida);
    }
    // Y explícitamente: ningún valor de celda es un id numérico crudo de referencia (4, 9, 5, 8, 10) fuera de Cantidad/Total.
    const filaDatos = ws.getRow(2).values as unknown[];
    expect(filaDatos).not.toContain(4); // empleadoId
    expect(filaDatos).not.toContain(9); // vehiculoId
    expect(filaDatos).not.toContain(10); // solicitudId
  });

  it("anchos de columna definidos para las 9 columnas (legibles, no el ancho por defecto)", async () => {
    const buf = await exportarReporteFondosExcel([fila()]);
    const ws = await primeraHoja(buf);
    for (let i = 1; i <= 9; i++) {
      expect(ws.getColumn(i).width).toBeGreaterThanOrEqual(10);
    }
  });
});

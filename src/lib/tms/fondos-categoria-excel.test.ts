import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { exportarReporteFondosExcel } from "./gastos-export-excel";
import { resumirSolicitudesFondo, type FilaSolicitudFondoReporte } from "./reportes-gastos";

/** OP-FONDOS-REP-01 — Excel del reporte de fondos: layout intacto sin filtro; con filtro, categoría + subtotales + hoja Resumen. */
function f(over: Partial<FilaSolicitudFondoReporte>): FilaSolicitudFondoReporte {
  return {
    lineaId: 1, solicitudId: 10, solicitudCodigo: "F-10", fechaSolicitud: "2026-09-03", fechaViaje: null, empleadoId: null, empleadoNombre: "Heber", cargo: null,
    vehiculoId: null, placa: "C-130BQ", clienteId: null, clienteNombre: "Cliente A", planId: null, categoria: "Combustible", cantidad: 2, descripcion: "d", monto: 100.5,
    total: 201, totalExacto: "201.0000", totalSolicitud: 501, estadoFondo: "Autorizada", ...over,
  };
}
async function leer(buf: Buffer) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as never); return wb; }

describe("Excel del reporte de fondos", () => {
  it("SIN categoría: mismo layout de 20 columnas, una sola hoja, 'Total solicitud' con su rótulo original", async () => {
    const wb = await leer(await exportarReporteFondosExcel([f({}), f({ lineaId: 2, categoria: "Hospedaje", cantidad: 1, monto: 300, total: 300, totalExacto: "300.0000" })]));
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Solicitudes de fondo"]);
    const ws = wb.getWorksheet("Solicitudes de fondo")!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers).toHaveLength(20);
    expect(headers[18]).toBe("Total solicitud");
    expect(headers).not.toContain("Categoría");
    expect(ws.rowCount).toBe(3); // las dos categorías, sin filtrar
  });

  it("CON categoría: solo las filas del filtro, columnas Categoría + Subtotal, 'Total solicitud (todas las categorías)' y hoja Resumen idéntica al resumen de pantalla", async () => {
    const filas = [
      f({ lineaId: 1, subtotalCategoria: 201 }),
      f({ lineaId: 3, solicitudId: 11, solicitudCodigo: "F-11", cantidad: 3, monto: 20.05, total: 60.15, totalExacto: "60.1500", totalSolicitud: 60.15, estadoFondo: "Liquidada", subtotalCategoria: 60.15 }),
    ];
    const resumen = resumirSolicitudesFondo(filas, "Combustible");
    const wb = await leer(await exportarReporteFondosExcel(filas, resumen, "Combustible"));
    const ws = wb.getWorksheet("Solicitudes de fondo")!;
    const headers = (ws.getRow(1).values as unknown[]).slice(1);
    expect(headers).toHaveLength(22);
    expect(headers[18]).toBe("Total solicitud (todas las categorías)");
    expect(headers.slice(20)).toEqual(["Categoría", "Subtotal Combustible de la solicitud"]);
    expect(ws.rowCount).toBe(3);
    const r2 = (ws.getRow(2).values as unknown[]).slice(1);
    expect([r2[13], r2[18], r2[20], r2[21]]).toEqual([201, 501, "Combustible", 201]); // total línea, total solicitud (cabecera), categoría, subtotal
    const r3 = (ws.getRow(3).values as unknown[]).slice(1);
    expect([r3[13], r3[21]]).toEqual([60.15, 60.15]);

    const hr = wb.getWorksheet("Resumen")!;
    const pares = new Map<string, unknown>();
    hr.eachRow((row) => { const v = row.values as unknown[]; pares.set(String(v[1]), v[2]); });
    expect(pares.get("Filtro de categoría")).toBe("Combustible");
    expect(pares.get("Solicitudes distintas")).toBe(resumen.cantidad);
    expect(pares.get("Subtotal Combustible solicitado (todas las solicitudes del filtro)")).toBe(resumen.totalSolicitado);
    expect(pares.get("Subtotal Combustible en solicitudes Autorizadas + Liquidadas")).toBe(resumen.totalAutorizado);
    expect(pares.get("Subtotal Combustible en solicitudes Liquidadas")).toBe(60.15);
    expect(pares.get("Subtotal Combustible en solicitudes Pendientes")).toBe(0);
    expect(resumen.totalSolicitado).toBe(261.15);
  });
});

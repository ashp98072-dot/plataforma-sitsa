import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { PlanReporte } from "./reportes-viajes";
import { COLUMNAS_PLANES_VIAJES, fechaCelda, fechaHoraCelda, nombreArchivoPlanesViajes, planesViajesAExcel, SHEET_PLANES_VIAJES } from "./planes-viajes-excel";

import { planFixture } from "./planes-viajes-excel.fixture";

async function abrir(planes: PlanReporte[], cuadrilla = new Map()) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await planesViajesAExcel(planes, cuadrilla)) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  return wb.getWorksheet(SHEET_PLANES_VIAJES)!;
}
const col = (nombre: string) => COLUMNAS_PLANES_VIAJES.findIndex((c) => c.header === nombre) + 1;

describe("Planes / Viajes → Excel", () => {
  it("el libro abre y tiene EXACTAMENTE una fila por viaje más el encabezado, con las columnas pedidas", async () => {
    const ws = await abrir([planFixture(), planFixture({ id: 2, codigo: "P-2" }), planFixture({ id: 3, codigo: "P-3" })]);
    expect(ws.rowCount).toBe(4);
    const cab = ws.getRow(1).values as (string | undefined)[];
    for (const c of [
      "Código", "Fecha", "Cliente", "Ruta", "Vehículo solicitado", "Placa / Unidad", "Piloto", "Piloto extra", "Auxiliares", "Cuadrilla", "Hora salida", "Hora llegada", "Km salida", "Km llegada",
      "Km recorridos", "Evidencias", "Tarifa usada", "Tarifa comercial", "Cargos adicionales", "Subtotal comercial", "Estado del viaje", "Estado de liquidación", "Estado factura",
      "Número factura", "Monto facturado", "Estado cobro", "Total factura", "Cobrado", "Saldo",
    ]) expect(cab).toContain(c);
  });

  it("formato: encabezado en negrita, autofiltro, encabezado congelado, anchos razonables y wrap en nombres largos", async () => {
    const ws = await abrir([planFixture()]);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    for (const c of ws.columns) expect(c.width).toBeGreaterThanOrEqual(10);
    for (const nombre of ["Cliente", "Auxiliares", "Cuadrilla", "Piloto"]) expect(ws.getColumn(col(nombre)).alignment?.wrapText).toBe(true);
  });

  it("fechas como fecha, horas como fecha/hora y montos/km como NÚMEROS (no texto con «Q»)", async () => {
    const ws = await abrir([planFixture()]);
    const f = ws.getRow(2);
    expect(f.getCell(col("Fecha")).value).toBeInstanceOf(Date);
    expect((f.getCell(col("Fecha")).value as Date).toISOString().slice(0, 10)).toBe("2026-10-16");
    expect(ws.getColumn(col("Fecha")).numFmt).toBe("dd/mm/yyyy");
    expect((f.getCell(col("Hora salida")).value as Date).toISOString()).toBe("2026-10-16T07:30:00.000Z"); // reloj de pared, sin corrimiento de zona
    expect((f.getCell(col("Hora llegada")).value as Date).toISOString()).toBe("2026-10-16T18:05:00.000Z");
    for (const [n, v] of [["Km salida", 1000], ["Km llegada", 1350], ["Km recorridos", 350], ["Evidencias", 3], ["Tarifa comercial", 1250.5], ["Cargos adicionales", 100],
      ["Subtotal comercial", 1350.5], ["Monto facturado", 1350.5], ["Total factura", 2701], ["Cobrado", 1000], ["Saldo", 1701]] as const) {
      expect(typeof f.getCell(col(n)).value, n).toBe("number");
      expect(f.getCell(col(n)).value, n).toBe(v);
    }
    expect(ws.getColumn(col("Saldo")).numFmt).toContain("#,##0.00");
  });

  it("vehículo solicitado = fotografía del viaje; histórico sin dato → «—» (nunca se infiere de la placa)", async () => {
    const ws = await abrir([
      planFixture({ id: 1, vehiculoSolicitado: "Camión 2.5 toneladas", placa: "C-500" }),
      planFixture({ id: 2, vehiculoSolicitado: null, placa: "C-500", unidadCapacidad: "5 t" }),
      planFixture({ id: 3, vehiculoSolicitado: "  ", placa: "C-500" }),
    ]);
    expect(ws.getRow(2).getCell(col("Vehículo solicitado")).value).toBe("Camión 2.5 toneladas");
    expect(ws.getRow(3).getCell(col("Vehículo solicitado")).value).toBe("—");
    expect(ws.getRow(4).getCell(col("Vehículo solicitado")).value).toBe("—");
    expect(ws.getRow(2).getCell(col("Placa / Unidad")).value).toBe("C-500"); // la unidad real va aparte
  });

  it("viaje tercerizado, sin factura, sin km ni tarifa: celdas vacías (no «0» inventado) y textos de apoyo", async () => {
    const ws = await abrir([planFixture({
      id: 7, estado: "Programado", placa: null, piloto: "Piloto Externo", pilotoExtra: null, auxiliares: [], kmSalida: null, kmLlegada: null, kmRecorridos: null, horaSalida: null, horaLlegada: null,
      tarifaComercial: null, tarifaNombre: null, subtotalComercial: null, cargosAdicionales: undefined, evidencias: 0, estadoFacturacion: "No aplica", numeroFactura: null, estadoAdminFactura: null,
      estadoFinancieroFactura: null, montoFacturadoViaje: null, montoBorradorViaje: null, totalFactura: null, totalPagadoFactura: null, saldoFactura: null,
    })]);
    const f = ws.getRow(2);
    for (const n of ["Km salida", "Km llegada", "Km recorridos", "Tarifa comercial", "Subtotal comercial", "Monto facturado", "Total factura", "Cobrado", "Saldo", "Hora salida", "Hora llegada"]) {
      expect(f.getCell(col(n)).value ?? null, n).toBeNull();
    }
    expect(f.getCell(col("Placa / Unidad")).value).toBe("—");
    expect(f.getCell(col("Cargos adicionales")).value).toBe(0);
    expect(f.getCell(col("Estado factura")).value).toBe("No aplica");
  });

  it("auxiliares y cuadrilla: una línea por persona; piloto extra separado; estado pendiente de cierre visible", async () => {
    const cuadrilla = new Map([[1, [{ tipo: "INTERNO", empleadoId: 5, nombre: "Carlos Cuadrilla", identificacion: null, telefono: null }, { tipo: "EXTERNO", empleadoId: null, nombre: "Externo Dos", identificacion: null, telefono: null }]]]);
    const ws = await abrir([planFixture({ estado: "En ruta", pendienteCierre: true })], cuadrilla as never);
    const f = ws.getRow(2);
    expect(f.getCell(col("Auxiliares")).value).toBe("Ana López\nPedro Ruiz");
    expect(f.getCell(col("Cuadrilla")).value).toBe("Carlos Cuadrilla (interno)\nExterno Dos (externo)");
    expect(f.getCell(col("Piloto extra")).value).toBe("Luis Gómez");
    expect(f.getCell(col("Estado del viaje")).value).toBe("En ruta (pendiente de cierre)");
  });

  it("monto del borrador se muestra como en la pantalla (facturado o, si no, borrador) y sin factura emitida el cobro queda «—»", async () => {
    const ws = await abrir([planFixture({ montoFacturadoViaje: null, montoBorradorViaje: 900, estadoFacturacion: "En borrador de factura", estadoFinancieroFactura: null })]);
    expect(ws.getRow(2).getCell(col("Monto facturado")).value).toBe(900);
    expect(ws.getRow(2).getCell(col("Estado cobro")).value).toBe("—");
  });

  it("libro vacío (sin viajes) es válido: solo encabezado", async () => {
    expect((await abrir([])).rowCount).toBe(1);
  });

  it("helpers de fecha y nombre de archivo", () => {
    expect(fechaCelda("2026-10-16")).toBeInstanceOf(Date);
    expect(fechaCelda(null)).toBeNull();
    expect(fechaCelda("texto")).toBe("texto");
    expect(fechaHoraCelda("2026-10-16 07:05:00")).toBeInstanceOf(Date);
    expect(nombreArchivoPlanesViajes({ fechaDesde: "2026-10-01", fechaHasta: "2026-10-17" }, "2026-10-17")).toBe("planes-viajes_2026-10-01_al_2026-10-17.xlsx");
    expect(nombreArchivoPlanesViajes({ fechaDesde: "2026-10-01" }, "2026-10-17")).toBe("planes-viajes_2026-10-17.xlsx");
    expect(nombreArchivoPlanesViajes({}, "2026-10-17")).toBe("planes-viajes_2026-10-17.xlsx");
    expect(nombreArchivoPlanesViajes({ fechaDesde: "x", fechaHasta: "y" }, "2026-10-17")).toBe("planes-viajes_2026-10-17.xlsx");
  });
});

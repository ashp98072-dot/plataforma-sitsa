import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/lib/tms/viaticos", () => ({ listarViaticosAutorizadosPorPeriodo: vi.fn() }));

import { listarViaticosAutorizadosPorPeriodo } from "@/lib/tms/viaticos";
import { comprobanteAutorizacionesExcel } from "./viaticos-comprobante-excel";

const VIATICO_BASE = {
  id: 1,
  planId: 1,
  planCodigo: "VJ-001",
  fechaPlan: "2026-09-15",
  cliente: "PriceSmart",
  unidadPlaca: "P-123ABC",
  lugarDescarga: "Zona 12",
  personalId: 4,
  personalNombre: "Juan Pérez",
  rol: "Piloto",
  puesto: "Piloto",
  montoAsignado: 100,
} as unknown as Awaited<ReturnType<typeof listarViaticosAutorizadosPorPeriodo>>[number];

const PERIODO_BASE = {
  inicio: "2026-09-01 00:00:00",
  finExclusivo: "2026-10-01 00:00:00",
  etiqueta: "septiembre de 2026",
  archivo: "viaticos-autorizados-2026-09.pdf",
  archivoExcel: "viaticos-autorizados-2026-09.xlsx",
};

async function libro(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(new Uint8Array(buf).buffer);
  return wb.worksheets[0];
}

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("comprobanteAutorizacionesExcel", () => {
  it("28/6. regresa null cuando no hay ningún viático AUTORIZADO (nunca un Excel vacío)", async () => {
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([]);
    const buf = await comprobanteAutorizacionesExcel(7, "SITSA", PERIODO_BASE);
    expect(buf).toBeNull();
    expect(listarViaticosAutorizadosPorPeriodo).toHaveBeenCalledWith(7, PERIODO_BASE.inicio, PERIODO_BASE.finExclusivo);
  });

  it("28. genera un xlsx válido con título, cabecera (empresa/período/conteo) y hoja 'Requerimiento de viáticos'", async () => {
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([VIATICO_BASE]);
    const buf = await comprobanteAutorizacionesExcel(7, "Kuiqtrans / Logiservicios Mónaco", PERIODO_BASE);
    expect(buf).not.toBeNull();
    const ws = await libro(buf!);
    expect(ws.name).toBe("Requerimiento de viáticos");
    expect(ws.getCell("A1").value).toBe("REQUERIMIENTO DE VIÁTICOS");
    expect(ws.getCell("A2").value).toBe("Empresa requiriente");
    expect(ws.getCell("D2").value).toBe("Kuiqtrans / Logiservicios Mónaco");
    expect(ws.getCell("A3").value).toBe("Período");
    expect(ws.getCell("D3").value).toBe("septiembre de 2026");
    expect(ws.getCell("D4").value).toBe("1 viático autorizado");
  });

  it("33/35. columnas: mismas 9 del PDF, SIN Código de petición/Persona que requiere/Fecha de solicitud/No. Cuenta/Banco/Autorizado por/Fecha autorización/Código de firma", async () => {
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([VIATICO_BASE]);
    const buf = await comprobanteAutorizacionesExcel(7, "SITSA", PERIODO_BASE);
    const ws = await libro(buf!);
    const h = ws.getRow(6);
    expect((h.values as unknown[]).slice(1)).toEqual([
      "Viaje", "Fecha viaje", "Nombre", "Cargo", "Placa", "Cliente", "Cantidad", "Lugar de descarga", "Total",
    ]);
    const todosLosEncabezados = (h.values as unknown[]).filter(Boolean).map(String);
    for (const prohibido of ["Código de petición", "Persona que requiere", "Fecha de solicitud", "No. Cuenta", "Banco", "Autorizado por", "Fecha autorización", "Código de firma"]) {
      expect(todosLosEncabezados).not.toContain(prohibido);
    }
  });

  it("29. mismos datos de la fila que filasComprobante() (DTO compartido con el PDF)", async () => {
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([VIATICO_BASE]);
    const buf = await comprobanteAutorizacionesExcel(7, "SITSA", PERIODO_BASE);
    const ws = await libro(buf!);
    const fila = ws.getRow(7);
    expect(fila.getCell(1).value).toBe("VJ-001");
    expect(fila.getCell(2).value).toBe("15/09/2026");
    expect(fila.getCell(3).value).toBe("Juan Pérez");
    expect(fila.getCell(4).value).toBe("Piloto");
    expect(fila.getCell(5).value).toBe("P-123ABC");
    expect(fila.getCell(6).value).toBe("PriceSmart");
    expect(fila.getCell(7).value).toBe(1);
    expect(fila.getCell(8).value).toBe("Zona 12");
    expect(fila.getCell(9).value).toBe(100);
  });

  it("32. Total en formato GTQ", async () => {
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([VIATICO_BASE]);
    const buf = await comprobanteAutorizacionesExcel(7, "SITSA", PERIODO_BASE);
    const ws = await libro(buf!);
    expect(ws.getColumn(9).numFmt).toContain("#,##0.00");
  });

  it("33. autofiltro y encabezado congelado", async () => {
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([VIATICO_BASE]);
    const buf = await comprobanteAutorizacionesExcel(7, "SITSA", PERIODO_BASE);
    const ws = await libro(buf!);
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 6 });
  });

  it("32. TOTAL GENERAL suma exacta de las filas exportadas", async () => {
    const v2 = { ...VIATICO_BASE, id: 2, planCodigo: "VJ-002", montoAsignado: 250.5 };
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([VIATICO_BASE, v2]);
    const buf = await comprobanteAutorizacionesExcel(7, "SITSA", PERIODO_BASE);
    const ws = await libro(buf!);
    const filaTotal = ws.getRow(ws.rowCount);
    expect(filaTotal.getCell(7).value).toBe("TOTAL GENERAL");
    expect(filaTotal.getCell(9).value).toBe(350.5);
  });

  it("29/30. varias filas quedan en el mismo orden que la consulta, una por cada viático", async () => {
    const v2 = { ...VIATICO_BASE, id: 2, planCodigo: "VJ-002", personalNombre: "María López" };
    vi.mocked(listarViaticosAutorizadosPorPeriodo).mockResolvedValue([VIATICO_BASE, v2]);
    const buf = await comprobanteAutorizacionesExcel(7, "SITSA", PERIODO_BASE);
    const ws = await libro(buf!);
    expect(ws.getRow(7).getCell(3).value).toBe("Juan Pérez");
    expect(ws.getRow(8).getCell(3).value).toBe("María López");
  });
});

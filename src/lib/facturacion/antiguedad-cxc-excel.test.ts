import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { antiguedadAExcel } from "./antiguedad-cxc-excel";
import type { FilaAntiguedad } from "./antiguedad-cxc-shared";

const fila = (over: Partial<FilaAntiguedad>): FilaAntiguedad => ({
  facturaId: 1, clienteId: 2, cliente: "Cli", numeroFactura: "F-1", fechaEmision: "2026-10-01", diasDesdeEmision: 20, montoOriginal: "100.00",
  montoCobrado: "0.00", saldoPendiente: "100.00", moneda: "GTQ", entidadId: null, entidad: "Sin entidad", tramo: "16-30", ...over,
});
async function leer(buf: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as never);
  return wb;
}

describe("MIL-CXC-ANT-01 · Excel: importes grandes y centavos sin pérdida", () => {
  it("máximo DECIMAL(14,2) y centavos: número EXACTO (ida y vuelta) con formato monetario", async () => {
    const casos = ["999999999999.99", "0.01", "0.30", "123456789012.34", "1999999999999.96", "100.20"];
    const filas = casos.map((v, i) => fila({ facturaId: i + 1, montoOriginal: v, montoCobrado: "0.00", saldoPendiente: v }));
    const wb = await leer(await antiguedadAExcel(filas, [], [], "2026-11-30"));
    const ws = wb.getWorksheet("Antigüedad")!;
    casos.forEach((v, i) => {
      const c = ws.getRow(5 + i).getCell(8); // Saldo pendiente
      expect(typeof c.value).toBe("number");
      expect((c.value as number).toFixed(2)).toBe(v);
      expect(c.numFmt).toBe("#,##0.00");
    });
  });
  it("importes de 16+ dígitos (sumas gigantes) van como TEXTO con la cadena exacta, nunca redondeados", async () => {
    const g = "19999999999999.80", h = "9007199254740993.01";
    const wb = await leer(await antiguedadAExcel(
      [fila({ montoOriginal: g, saldoPendiente: g })],
      [{ moneda: "GTQ", tramo: "16-30", facturas: 20, saldo: g }],
      [{ moneda: "GTQ", facturas: 20, saldo: h }],
      "2026-11-30",
    ));
    const c = wb.getWorksheet("Antigüedad")!.getRow(5).getCell(8);
    expect(c.value).toBe(g);
    const t = wb.getWorksheet("Totales")!;
    expect(t.getRow(2).getCell(4).value).toBe(g);
    expect(t.getRow(4).getCell(4).value).toBe(h);
  });
  it("hoja de totales: número exacto cuando cabe; filas por tramo y total de moneda separados por moneda", async () => {
    const wb = await leer(await antiguedadAExcel(
      [],
      [{ moneda: "GTQ", tramo: "0-15", facturas: 2, saldo: "1000.10" }, { moneda: "USD", tramo: "90+", facturas: 1, saldo: "5.05" }],
      [{ moneda: "GTQ", facturas: 2, saldo: "1000.10" }, { moneda: "USD", facturas: 1, saldo: "5.05" }],
      "2026-11-30",
    ));
    const t = wb.getWorksheet("Totales")!;
    expect([t.getRow(2).getCell(1).value, t.getRow(2).getCell(4).value]).toEqual(["GTQ", 1000.1]);
    expect([t.getRow(3).getCell(1).value, t.getRow(3).getCell(4).value]).toEqual(["USD", 5.05]);
  });
  it("la nota aclara saldo actual y fecha de corte no histórica", async () => {
    const wb = await leer(await antiguedadAExcel([], [], [], "2026-11-29"));
    const ws = wb.getWorksheet("Antigüedad")!;
    expect(String(ws.getRow(2).getCell(1).value)).toMatch(/ACTUALES/);
    expect(String(ws.getRow(2).getCell(1).value)).toMatch(/no representa un saldo histórico/);
    expect(ws.getRow(3).getCell(1).value).toBe("Fecha de corte: 2026-11-29");
  });
});

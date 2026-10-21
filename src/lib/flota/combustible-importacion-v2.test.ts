import { describe, expect, it } from "vitest";
import { analizarProveedorV2, decimalCeldaProveedor } from "./combustible-importacion-v2";
import { fixtureHalelV2, fixtureShellV2 } from "./combustible-importacion-v2.fixture";
import { analizarExcelProveedor } from "./combustible-importacion-parser";
import { fixtureProveedor } from "./combustible-importacion.fixture";

describe("contrato común v2 y compatibilidad v1", () => {
  it("HALEL: 39 apariciones, 21 candidatos, 18 repetidos y conflicto de precio bloqueado en ambas versiones", async () => {
    const a = await analizarProveedorV2(await fixtureHalelV2(), "HALEL");
    expect(a).toMatchObject({ versionContrato: 2, perfil: "HALEL", versionParser: 1 });
    expect(a.resumen).toMatchObject({ apariciones: 39, candidatos: 21, duplicados: 17, conflictos: 1, elegibles: 20 });
    expect(a.filas.filter(f => f.conflicto)).toHaveLength(2);
    expect(a.filas.filter(f => f.conflicto).map(f => f.precio).sort()).toEqual(["200", "41.59"]);
    expect(a.filas.filter(f => f.estado !== "IGNORADA").every(f => f.galones === "4.809")).toBe(true);
    expect(a.filas.filter(f => f.estado !== "IGNORADA").every(f => f.producto === null)).toBe(true);
    expect(a.filas.some(f => f.textos.km === "NO MARCA KM" && f.kilometraje === null)).toBe(true);
    expect(a.filas.some(f => f.estado === "IGNORADA" && f.celdas.some(c => c.tipo === 6))).toBe(true);
    expect(a.filas.find(f => f.identidadCandidata)?.factura).toBe("001");
    expect(a.resumen.montoElegible).toBe("4000");
  });
  it("SHELL: 663 candidatos, fórmulas compartidas y sumas verificadas, fechas originales y auxiliares", async () => {
    const a = await analizarProveedorV2(await fixtureShellV2(), "SHELL");
    expect(a.resumen).toMatchObject({ apariciones: 663, candidatos: 663, elegibles: 663, conflictos: 0, duplicados: 0, invalidas: 0 });
    const ops = a.filas.filter(f => f.estado !== "IGNORADA");
    expect(ops.every(f => f.galonesCalculados && f.galones === "2.5")).toBe(true);
    expect(ops.filter(f => f.motivos.some(m => m.includes("fuera del mes")))).toHaveLength(16);
    expect(ops.find(f => f.hoja === "SEPTIEMBRE" && f.fila === 42)?.fechaConsumo).toBe("2026-08-03");
    expect(ops.find(f => f.hoja === "SEPTIEMBRE" && f.fila === 333)).toMatchObject({ serie: "", factura: "", estado: "ADVERTENCIA" });
    expect(ops.find(f => f.hoja === "OCUTUBRE" && f.fila === 156)?.pilotoInformado).toBeNull();
    expect(ops[0].vale.startsWith("00")).toBe(true);
    expect(a.resumen).toMatchObject({ galonesElegibles: "1657.5", montoElegible: "66300" });
    expect(a.filas.find(f => f.hoja === "OCUTUBRE" && f.fila === 331)?.estado).toBe("IGNORADA");
  });
  it("v1 conserva fecha de reporte, clasificación y tipo históricos", async () => {
    const a = await analizarExcelProveedor(await fixtureProveedor());
    expect(a.resumen).toMatchObject({ encontradas: 20, operacionesUnicasEstimadas: 10 });
    expect(a.filas.find(f => f.fechaReporte)).not.toHaveProperty("fechaConsumo");
  });
  it("solo corrige ruido binario numérico; no trunca precisión real o texto ni acepta coma ambigua", () => {
    expect(decimalCeldaProveedor(4.8090000000000002)).toBe("4.809");
    expect(decimalCeldaProveedor(1.1234567)).toBeNull();
    expect(decimalCeldaProveedor("4.8090000000000002")).toBeNull();
    expect(decimalCeldaProveedor("1,234.50")).toBe("1234.5");
    expect(decimalCeldaProveedor("1,25")).toBeNull();
    expect(decimalCeldaProveedor(Infinity)).toBeNull();
  });
  it.each(["SUM(E2:E4)", "WEBSERVICE(\"https://example.invalid\")", "E3/H3", "E2/0", "E2+H2"])("bloquea fórmula no permitida %s", async formula => {
    const a = await analizarProveedorV2(await fixtureShellV2(w => { w.worksheets[0].getCell("F2").value = { formula, result: 2.5 }; }), "SHELL");
    expect(a.filas.find(f => f.hoja === "25-31 AGOSTO" && f.fila === 2)?.estado).toBe("INVALIDA");
    // Alterar el maestro de una fórmula compartida invalida también a sus dependientes.
    expect(a.resumen.elegibles).toBeLessThanOrEqual(662);
  });
  it.each([undefined, 999])("bloquea fórmula sin cache verificable (%s)", async result => {
    const a = await analizarProveedorV2(await fixtureShellV2(w => { w.worksheets[0].getCell("F2").value = { formula: "E2/H2", result }; }), "SHELL");
    expect(a.resumen.invalidas).toBeGreaterThanOrEqual(1);
  });
  it("no admite fórmulas en identificadores ni sumas no verificables en montos", async () => {
    const a = await analizarProveedorV2(await fixtureShellV2(w => {
      w.worksheets[0].getCell("D2").value = { formula: "1+1", result: 2 };
      w.worksheets[1].getCell("E308").value = { formula: "60+40", result: 500 };
    }), "SHELL");
    expect(a.filas.find(f => f.hoja === "25-31 AGOSTO" && f.fila === 2)?.estado).toBe("INVALIDA");
    expect(a.filas.find(f => f.hoja === "SEPTIEMBRE" && f.fila === 308)?.estado).toBe("INVALIDA");
  });
  it("identificadores numéricos fuera del rango seguro quedan bloqueados sin inventar dígitos", async () => {
    const a = await analizarProveedorV2(await fixtureShellV2(w => {
      w.worksheets[1].getCell("C354").value = 12345678901234567890;
    }), "SHELL");
    expect(a.filas.find(f => f.hoja === "SEPTIEMBRE" && f.fila === 354)).toMatchObject({ estado: "INVALIDA", motivos: expect.arrayContaining(["serie: identificador numérico no seguro; literal XML conservado, exige revisión"]) });
  });
  it("duplicado exacto conserva ambas evidencias, un candidato y una suma", async () => {
    const a = await analizarProveedorV2(await fixtureHalelV2(w => {
      const s = w.worksheets[0]; s.getCell("E13").value = 41.59;
      s.addRow(s.getRow(3).values);
    }), "HALEL");
    expect(a.resumen).toMatchObject({ apariciones: 40, candidatos: 21, duplicados: 19, conflictos: 0, elegibles: 21, montoElegible: "4200" });
    const dup = a.filas.find(f => f.duplicadoDe != null)!;
    expect(a.filas[dup.duplicadoDe!].vale).toBe(dup.vale);
  });
  it("preserva padding numérico, km decimal, factura de texto y fecha Excel 1904", async () => {
    const a = await analizarProveedorV2(await fixtureHalelV2(w => {
      w.properties.date1904 = true;
      const s = w.worksheets[0];
      s.getCell("A23").value = 44842; // 2026-10-09 con base 1904
      s.getCell("C23").value = 23; s.getCell("C23").numFmt = "000000";
      s.getCell("J23").value = 12; s.getCell("J23").numFmt = "000000";
      s.getCell("G23").value = 9748.8;
    }), "HALEL");
    expect(a.filas.find(f => f.hoja === "Consolidado" && f.fila === 23)).toMatchObject({ vale: "000023", factura: "000012", kilometraje: "9748.8", fechaConsumo: "2026-10-09" });
  });
  it("rechaza columnas ambiguas y libros sin contrato reconocido", async () => {
    await expect(analizarProveedorV2(await fixtureHalelV2(w => { w.worksheets[0].getCell("L2").value = "VALE"; }), "HALEL")).rejects.toThrow("ambiguos");
    await expect(analizarProveedorV2(Buffer.from("no excel"), "SHELL")).rejects.toThrow();
  });
});

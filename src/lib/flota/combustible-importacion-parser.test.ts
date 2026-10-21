import { describe, expect, it } from "vitest";
import { analizarExcelProveedor, decimalImportado, hashImportacion, normalizarIdentificador, normalizarPlacaImportada, validarArchivoImportacion, validarContenedorXlsx } from "./combustible-importacion-parser";
import { fixtureProveedor } from "./combustible-importacion.fixture";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";
describe("HALEL anonimizado", () => {
  it("tres hojas 20 apariciones -> 10 estimadas; no elimina filas originales", async () => {
    const a = await analizarExcelProveedor(await fixtureProveedor());
    expect(a.resumen).toMatchObject({ encontradas: 20, operacionesUnicasEstimadas: 10, duplicadosInternos: 10, invalidas: 0 });
    expect(a.filas.filter(f => f.estado === "IGNORADA").length).toBeGreaterThan(3);
    const duplicado = a.filas.find(f => f.duplicado === "EXACTO")!;
    expect(a.filas[duplicado.canonica!].fingerprint).toBe(duplicado.fingerprint);
    expect(duplicado.hoja).not.toBe(a.filas[duplicado.canonica!].hoja);
  });
  it("conserva NO MARCA KM, decimal, piloto desconocido, serie/factura y fecha neutral", async () => {
    const a = await analizarExcelProveedor(await fixtureProveedor());
    expect(a.filas.find(f => f.textos.km === "NO MARCA KM")?.kilometraje).toBeNull();
    expect(a.filas.find(f => f.textos.km === "9748.8")?.kilometraje).toBe("9748.8");
    const f = a.filas.find(f => f.textos.piloto === "NO TIENE NOMBRE")!;
    expect(f.textos).toMatchObject({ piloto: "NO TIENE NOMBRE", serie: "SERIE-DEMO", factura: "0006" });
    expect(f.fechaReporte).toBe("2026-10-09"); expect(f.raw.length).toBe(10);
    expect(f).not.toHaveProperty("empleadoId"); expect(f).not.toHaveProperty("cargaId");
  });
  it.each(["NO. DE VALE", "No de Vale", "VALE"])("alias cerrado %s", async vale => {
    const a = await analizarExcelProveedor(await fixtureProveedor(w => { for (const ws of w.worksheets) { const r = ws.name === "Hoja4" ? 1 : 2; ws.getCell(r, 3).value = vale; ws.getCell(r, 2).value = "PLACA"; ws.getCell(r, 6).value = "TOTAL"; } }));
    expect(a.resumen.operacionesUnicasEstimadas).toBe(10);
  });
  it("mismo vale con datos distintos es posible, no se fusiona", async () => {
    const a = await analizarExcelProveedor(await fixtureProveedor(w => { w.worksheets[1].getCell(3, 6).value = 999; }));
    expect(a.resumen.posiblesDuplicados).toBeGreaterThan(0); expect(a.resumen.operacionesUnicasEstimadas).toBe(11);
    expect(a.filas.find(f => f.total === "999")?.duplicado).toBe("POSIBLE");
  });
  it("preserva ceros y texto original de placa/vale; sin normalizador peligroso de prefijo C", async () => {
    expect(normalizarIdentificador("  00157301 ")).toBe("00157301"); expect(normalizarPlacaImportada(" c ‐ 123 ")).toBe("C-123");
    const a = await analizarExcelProveedor(await fixtureProveedor());
    expect(a.filas.find(f => f.estado !== "IGNORADA")?.textos.placa).toBe(" C-001ABC ");
    expect(a.filas.find(f => f.estado !== "IGNORADA")?.valeNormalizado).toBe("00157301");
  });
  it("número con formato 000000 conserva padding visible y valor crudo", async () => {
    const a = await analizarExcelProveedor(await fixtureProveedor(w => { w.worksheets[0].getCell(3, 3).value = 123; w.worksheets[0].getCell(3, 3).numFmt = "000000"; }));
    expect(a.filas.find(f => f.hoja === "Hoja1" && f.fila === 3)?.valeNormalizado).toBe("000123");
  });
  it("fila inválida conserva evidencia; fórmulas operativas no se evalúan", async () => {
    const a = await analizarExcelProveedor(await fixtureProveedor(w => { w.worksheets[0].getCell(3, 3).value = ""; w.worksheets[0].getCell(4, 6).value = { formula: "1+2", result: 3 }; }));
    expect(a.resumen.invalidas).toBe(2); expect(a.filas.find(f => f.fila === 4 && f.hoja === "Hoja1")?.raw.some(c => typeof c.valor === "object")).toBe(true);
  });
  it("hojas sin estructura se conservan, pero ninguna reconocida rechaza", async () => {
    const a = await analizarExcelProveedor(await fixtureProveedor(w => w.addWorksheet("Notas").addRow(["Texto de nota"])));
    expect(a.filas.find(f => f.hoja === "Notas")).toMatchObject({ estado: "IGNORADA", motivos: ["Hoja sin encabezado reconocido"] });
    await expect(analizarExcelProveedor(await fixtureProveedor(w => w.worksheets.forEach(ws => ws.getRow(ws.name === "Hoja4" ? 1 : 2).getCell(3).value = "Columna desconocida")))).rejects.toThrow("columnas mínimas");
  });
  it("archivo inválido/corrupto y exceso dimensional se rechazan", async () => {
    expect(() => validarContenedorXlsx(Buffer.from("no es excel"))).toThrow();
    await expect(analizarExcelProveedor(await fixtureProveedor(w => { w.worksheets[0].getCell(5001, 1).value = "fin"; }))).rejects.toMatchObject({ status: 413 });
    const b = await fixtureProveedor(); expect(hashImportacion(b)).toBe(hashImportacion(Buffer.from(b)));
  });
  it("extensión, MIME, vacío y tamaño", () => {
    for (const file of [{ name: "a.csv", size: 1 }, { name: "a.xlsx", type: "text/html", size: 1 }, { name: "a.xlsx", size: 0 }, { name: "a.xlsx", size: MAX_UPLOAD_BYTES + 1 }]) expect(() => validarArchivoImportacion(file)).toThrow();
  });
  it("decimales exactos sin truncar ni adivinar coma decimal", () => {
    expect(decimalImportado("1,234.50", 6)).toBe("1234.5"); expect(decimalImportado("1,25", 6)).toBeNull(); expect(decimalImportado("1.1234", 3)).toBeNull();
  });
});

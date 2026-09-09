import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { generarPlantillaRutas, parsearExcelRutas } from "@/lib/tms/rutas-import-excel";

describe("Excel modelo de rutas", () => {
  it("es compatible con el importador existente", async () => {
    const plantilla = await generarPlantillaRutas();
    const filas = await parsearExcelRutas(plantilla);
    expect(filas).toHaveLength(0);
  });

  it("conserva las columnas históricas y agrega tarifa/personal a la derecha", async () => {
    const plantilla = await generarPlantillaRutas();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(plantilla as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("CODIGOS DATA");
    expect(ws).toBeDefined();
    expect([3, 4, 5, 6, 7, 8].map((col) => ws!.getCell(1, col).value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect([3, 4, 5, 6, 7, 8].map((col) => ws!.getCell(2, col).value)).toEqual([
      "Código de ruta *", "Cliente *", "Lugar de carga", "Hora habitual", "Contacto", "Destino / lugar de descarga",
    ]);
    expect(ws!.getColumn("C").width).toBeGreaterThanOrEqual(14);
    expect(ws!.getColumn("H").width).toBeGreaterThanOrEqual(58);
    // TMS-SIN-COSTO-OPERATIVO-1: "Costo operativo" se retiró de la
    // plantilla — I..M corren una posición (antes I..N con costo en I).
    expect(ws!.getCell("I2").value).toBe("Tarifario (Q)");
    expect(ws!.getCell("J2").value).toBe("Código piloto habitual");
    expect(ws!.getCell("L2").value).toBe("Códigos auxiliares");
    expect(ws!.getCell("F1").numFmt).not.toBe("h:mm");
    expect(ws!.getCell("F2").numFmt).not.toBe("h:mm");
    expect(ws!.getColumn("F").numFmt).toBe("h:mm");
    expect(ws!.getCell("C3").value).toBe("EJEMPLO-NO-IMPORTAR");
    expect(wb.getWorksheet("AYUDA")!.getCell("A1").value).toBe("CÓMO IMPORTAR RUTAS DE FORMA MASIVA");
    const ayuda = wb.getWorksheet("AYUDA")!;
    const proceso = ayuda.getColumn("A").values.findIndex((value) => value === "Proceso");
    expect(ayuda.getCell(proceso, 2).value).toContain("Previsualizar");
  });

  it("lee filas llenadas debajo del encabezado oficial", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CODIGOS DATA");
    ws.getRow(1).values = [null, null, "Código", "Cliente", "Lugar de carga", "Hora", "Contacto", "Destino"];
    ws.getRow(2).values = [null, null, "1001", "Acme", "Bodega", "08:00", "Ana", "Sucursal"];
    const filas = await parsearExcelRutas(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(filas[0]).toMatchObject({ codigoExcel: "1001", clienteExcel: "Acme", horaExcel: "08:00" });
  });

  it("lee tarifa, piloto, auxiliares y viáticos opcionales", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CODIGOS DATA");
    ws.getRow(2).values = [null, null, "1001", "Acme", "Bodega", "08:00", "Ana", "Sucursal", 1250, "P-1", 150, "A-1; A-2", "75;80"];
    const [fila] = await parsearExcelRutas(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(fila).toMatchObject({
      tarifaReferenciaExcel: 1250,
      pilotoCodigoExcel: "P-1",
      pilotoViaticoExcel: 150,
      auxiliaresCodigosExcel: ["A-1", "A-2"],
      auxiliaresViaticosExcel: [75, 80],
    });
  });

  /** TMS-SIN-COSTO-OPERATIVO-1: la columna "Costo operativo" se retiró — el resultado nunca incluye ese campo. */
  it("ya no expone costoOperativoExcel (columna retirada de la plantilla)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CODIGOS DATA");
    ws.getRow(2).values = [null, null, "1001", "Acme", "Bodega", "08:00", "Ana", "Sucursal", 1250, "P-1", 150, "A-1; A-2", "75;80"];
    const [fila] = await parsearExcelRutas(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(fila).not.toHaveProperty("costoOperativoExcel");
  });

  it.each([
    ["-1", "Tarifario"],
    ["texto", "Tarifario"],
    ["Infinity", "Tarifario"],
    ["NaN", "Tarifario"],
  ])("rechaza monto inválido %s", async (monto, mensaje) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CODIGOS DATA");
    ws.getRow(2).values = [null, null, "1001", "Acme", "", "08:00", "", "Destino", monto];
    const [fila] = await parsearExcelRutas(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(fila.erroresCamposExcel.join(" ")).toContain(mensaje);
  });

  it("rechaza montos sobrantes o cantidad distinta de auxiliares", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CODIGOS DATA");
    ws.getRow(2).values = [null, null, "1001", "Acme", "", "08:00", "", "Destino", "", "", "", "A1", "10;20"];
    const [fila] = await parsearExcelRutas(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(fila.erroresCamposExcel).toContain("La cantidad de viáticos debe coincidir con la cantidad de auxiliares.");
  });

  it("permite NULL posicional solo con segmento realmente vacío", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("CODIGOS DATA");
    ws.getRow(2).values = [null, null, "1001", "Acme", "", "08:00", "", "Destino", "", "", "", "A1;A2", "10;"];
    const [fila] = await parsearExcelRutas(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(fila.erroresCamposExcel).toEqual([]);
    expect(fila.auxiliaresViaticosExcel).toEqual([10, null]);
  });
});

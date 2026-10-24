import { expect, it } from "vitest";
import { detectarFormatoCB2 } from "./detectar-formato";
import { archivoDeteccion, agregarTablaSintetica } from "./detectar-formato.fixture";
import { analizarProveedorV2 } from "../combustible-importacion-v2";
import { fixtureHalelV2, fixtureShellV2 } from "../combustible-importacion-v2.fixture";

it.each(["HALEL", "SHELL"] as const)("detecta %s con encabezados desplazados, normalizados, reordenados y repetidos", async perfil => {
    const buffer = await archivoDeteccion([], w => {
        for (let i = 1; i <= 2; i++) {
            const s = w.addWorksheet(`Hoja demo ${i}`);
            s.getCell("A1").value = "Título sintético"; s.getCell("A20").value = "LOTE: DEMO";
            agregarTablaSintetica(s, perfil, 37, 4); agregarTablaSintetica(s, perfil, 41, 4);
            const valores = s.getRow(37).values as unknown[];
            const headers = valores.slice(4).reverse().map(v => `  ${String(v).toUpperCase().replace(/A/g, "Á").replace(/ /g, "  ")}  `);
            s.getRow(37).values = [undefined, undefined, undefined, undefined, ...headers];
        }
        w.addWorksheet("Notas").getCell("A1").value = "Información auxiliar sintética";
    });
    expect(await detectarFormatoCB2(buffer)).toBe(perfil);
});

it.each([["HALEL", fixtureHalelV2], ["SHELL", fixtureShellV2]] as const)("despacha el parser existente para %s y conserva las filas y fórmulas", async (perfil, fixture) => {
    const buffer = await fixture(), detectado = await detectarFormatoCB2(buffer);
    expect(detectado).toBe(perfil);
    const automatico = await analizarProveedorV2(buffer, detectado), explicito = await analizarProveedorV2(buffer, perfil);
    expect(automatico).toEqual(explicito);
    if (perfil === "SHELL") expect(automatico.filas.some(f => f.galonesCalculados)).toBe(true);
});

it("rechaza mezcla entre hojas, también ocultas, y dentro de una misma hoja", async () => {
    await expect(detectarFormatoCB2(await archivoDeteccion(["HALEL", "SHELL"], w => { w.worksheets[1].state = "hidden"; }))).rejects.toThrow("mezcla formatos");
    await expect(detectarFormatoCB2(await archivoDeteccion(["HALEL"], w => agregarTablaSintetica(w.worksheets[0], "SHELL", 10)))).rejects.toThrow("mezcla formatos");
});

it("rechaza encabezado genérico, híbrido, incompleto y duplicado sin suponer un perfil", async () => {
    for (const editar of [
        (w: import("exceljs").Workbook) => { w.worksheets[0].getCell("F1").value = "MONTO"; },
        (w: import("exceljs").Workbook) => { w.worksheets[0].getCell("D1").value = "GLS"; },
        (w: import("exceljs").Workbook) => { w.worksheets[0].getCell("E1").value = "Precio desconocido"; },
        (w: import("exceljs").Workbook) => { w.worksheets[0].getCell("K1").value = "MONTO"; },
    ]) await expect(detectarFormatoCB2(await archivoDeteccion(["HALEL"], editar))).rejects.toThrow(/encabezado|Encabezados|distinguir/);
});

it("no acepta un libro sin encabezados aunque tenga los textos FECHA, PILOTO y PLACAS", async () => {
    await expect(detectarFormatoCB2(await archivoDeteccion([], w => { w.addWorksheet("HALEL SHELL").addRow(["FECHA", "PILOTO", "PLACAS"]); }))).rejects.toThrow("No se reconoce");
});

it("rechaza una segunda tabla incompleta en lugar de ignorarla silenciosamente", async () => {
    await expect(detectarFormatoCB2(await archivoDeteccion(["SHELL"], w => {
        const s = w.addWorksheet("Otra tabla"); agregarTablaSintetica(s, "HALEL"); s.getCell("E1").value = "Sin precio";
    }))).rejects.toThrow("incompleto");
});

it("mantiene los límites OOXML antes de ExcelJS y rechaza archivos dañados", async () => {
    await expect(detectarFormatoCB2(Buffer.from("No es Excel"))).rejects.toThrow();
    await expect(detectarFormatoCB2(await archivoDeteccion(["SHELL"], w => { w.worksheets[0].getCell(1, 101).value = "Fuera del límite"; }))).rejects.toThrow();
    await expect(detectarFormatoCB2(await archivoDeteccion(["HALEL"], w => { w.worksheets[0].getCell(5001, 1).value = "Fuera del límite"; }))).rejects.toThrow();
    await expect(detectarFormatoCB2(await archivoDeteccion(Array.from({ length: 21 }, () => "SHELL" as const)))).rejects.toThrow();
});

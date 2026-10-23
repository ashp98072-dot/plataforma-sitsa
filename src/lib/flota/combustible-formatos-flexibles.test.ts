import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { analizarProveedorV2 } from "./combustible-importacion-v2";
import { analizar } from "./cb2/model";
const A = ["FECHA", "VALE", "No. Serie", "No. factura", "MONTO", "GLS", "PRODUCTO", "PRECIO", "PILOTO", "PLACAS", "OBS."];
const B = ["FECHA", "Placas", "No. Vale", "Galones", "Precio", "Costo Total", "Kilometraje", "PILOTO", "SERIE", "NO. FACTURA"];
const fecha = new Date("2026-10-01T00:00:00Z");
const a = [fecha, "0007", "S01", "0009", 200, 10, "Diésel", 20, "  José   Chay ", "C 570 BZT", "nota original"];
const b = [fecha, "C-570BZT", "0008", 10, 20, 200, 12345, "HÉCTOR SET", "S02", "0010"];
async function buffer(edit: (w: ExcelJS.Workbook) => void) { const w = new ExcelJS.Workbook(); edit(w); return Buffer.from(await w.xlsx.writeBuffer()); }
describe("formatos reales sintéticos por encabezados, lotes y hojas", () => {
    it("reproduce parser 1 para evidencia histórica y mantiene claves operativas", async () => {
        const file = await buffer(w => { const s = w.addWorksheet("Datos"); s.addRow(["LOTE 2054"]); s.addRow(B); s.addRow(b); });
        const antiguo = await analizarProveedorV2(file, "HALEL", undefined, 1), nuevo = await analizarProveedorV2(file, "HALEL");
        expect(antiguo.versionParser).toBe(1); expect(nuevo.versionParser).toBe(2);
        expect(antiguo.filas[2].lote).toBeNull(); expect(nuevo.filas[2].lote).toBe("2054");
        expect(antiguo.filas[2].huella).toBe(nuevo.filas[2].huella);
        expect(antiguo.filas[2].identidadCandidata).toBe(nuevo.filas[2].identidadCandidata);
        const legacy = await analizar(file, "HALEL", "GTQ", 1), actual = await analizar(file, "HALEL", "GTQ", 2);
        expect(legacy[2].payload).toBe(actual[2].payload);
    });
    it("A en tres hojas, columnas reordenadas y evidencia literal sin duplicar identidades", async () => {
        const file = await buffer(w => {
            for (const name of ["AGOSTO", "SEPTIEMBRE", "OCTUBRE"]) { const s = w.addWorksheet(name); s.addRow([...A].reverse()); s.addRow([...a].reverse()); }
        });
        const p = await analizarProveedorV2(file, "SHELL");
        const ops = p.filas.filter(f => f.identidadCandidata);
        expect(ops).toHaveLength(3); expect(p.resumen.candidatos).toBe(1); expect(p.resumen.duplicados).toBe(2);
        expect(ops.map(f => [f.hoja, f.fila])).toEqual([["AGOSTO", 2], ["SEPTIEMBRE", 2], ["OCTUBRE", 2]]);
        expect(ops[0]).toMatchObject({ vale: "0007", serie: "S01", factura: "0009", pilotoInformado: "José   Chay", producto: "Diésel", galones: "10", monto: "200", precio: "20", kilometraje: null });
        expect(ops[0].textos.piloto).toBe("  José   Chay "); expect(ops[0].textos.placa).toBe("C 570 BZT");
        expect(ops[0].motivos.join(" ")).not.toContain("Kilometraje");
    });
    it("B hereda lotes de títulos, cambia mapa de columnas y conserva encabezados/subtotales/notas", async () => {
        const file = await buffer(w => {
            const s = w.addWorksheet("Lotes"); s.addRow(["LOTE 2054"]); s.addRow(B); s.addRow(b);
            s.addRow(["SUBTOTAL", "C-570BZT", "0008", 10, 20, 200]); s.addRow(["Nota administrativa"]);
            s.addRow(["LOTE 2055"]); s.addRow([...B].reverse()); s.addRow([...b].reverse());
            s.addRow([...B].reverse()); s.addRow([...b.slice(0, 2), "0009", ...b.slice(3)].reverse());
        });
        const p = await analizarProveedorV2(file, "HALEL");
        expect(p.filas).toHaveLength(10); expect(p.resumen).toMatchObject({ candidatos: 2, duplicados: 1, ignoradas: 7 });
        const ops = p.filas.filter(f => f.identidadCandidata);
        expect(ops.map(f => [f.fila, f.lote])).toEqual([[3, "2054"], [8, "2055"], [10, "2055"]]);
        expect(ops[0]).toMatchObject({ producto: null, kilometraje: "12345", serie: "S02", factura: "0010" });
        expect(ops[0].motivos).toContain("Producto no informado");
        expect(p.filas[0].celdas[0].valor).toBe("LOTE 2054");
        expect(p.filas[3].estado).toBe("IGNORADA");
        const lineas = await analizar(file, "HALEL", "GTQ");
        expect(new Set(lineas.filter(l => l.clave).map(l => l.clave)).size).toBe(2);
        expect(lineas.filter(l => l.clave).every(l => !l.bloqueada)).toBe(true);
    });
    it("encabezado después de 25 filas, lote combinado y ninguna herencia entre hojas", async () => {
        const file = await buffer(w => {
            const s = w.addWorksheet("Uno"); for (let i = 0; i < 30; i++) s.addRow(["Nota"]);
            s.mergeCells("A31:J31"); s.getCell("A31").value = "LOTE 002054"; s.addRow(B); s.addRow(b);
            const t = w.addWorksheet("Dos"); t.addRow(B); t.addRow(b);
        });
        const p = await analizarProveedorV2(file, "HALEL");
        expect(p.filas.filter(f => f.identidadCandidata).map(f => f.lote)).toEqual(["002054", null]);
    });
    it("sigue bloqueando datos ausentes, encabezados ambiguos y fórmulas HALEL", async () => {
        const file = await buffer(w => { const s = w.addWorksheet("Datos"); s.addRow(B); s.addRow(b); s.getCell("D2").value = { formula: "200/20", result: 10 }; s.getCell("A2").value = null; });
        const p = await analizarProveedorV2(file, "HALEL");
        expect(p.filas[1].estado).toBe("INVALIDA"); expect(p.filas[1].motivos.join(" ")).toContain("Fórmula no permitida");
        expect((await analizar(file, "HALEL", "GTQ"))[1].bloqueada).toBe(true);
        await expect(analizarProveedorV2(await buffer(w => w.addWorksheet("Datos").addRow([...B, "GLS"])), "HALEL")).rejects.toThrow("ambiguos");
    });
});

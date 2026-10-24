import ExcelJS from "exceljs";
import type { PerfilProveedor } from "../combustible-importacion-v2-types";

/** Fixtures sintéticos basados exclusivamente en los encabezados documentados. */
export const encabezadosDeteccion = {
    HALEL: ["FechaFactura", "Placas", "No. Vale", "Galones", "Precio", "Costo Total", "kilometraje", "PILOTO", "SERIE", "NRO. DE FACTURA"],
    SHELL: ["FECHA", "VALE", "No. Serie", "No. factura", "MONTO", "GLS", "PRODUCTO", "PRECIO", "PILOTO", "PLACAS"],
};
export function agregarTablaSintetica(hoja: ExcelJS.Worksheet, perfil: PerfilProveedor, fila = 1, columna = 1) {
    encabezadosDeteccion[perfil].forEach((h, i) => { hoja.getCell(fila, columna + i).value = h; });
    const datos = perfil === "HALEL"
        ? [new Date("2026-10-01T00:00:00Z"), "C-001ABC", "00001", 10, 40, 400, 1000, "PILOTO DEMO", "S-DEMO", "00002"]
        : [new Date("2026-10-01T00:00:00Z"), "00001", "S-DEMO", "00002", 400, 10, "DIESEL", 40, "PILOTO DEMO", "C-001ABC"];
    datos.forEach((v, i) => { hoja.getCell(fila + 1, columna + i).value = v; });
}
export async function archivoDeteccion(perfiles: PerfilProveedor[] = ["HALEL"], editar?: (w: ExcelJS.Workbook) => void) {
    const w = new ExcelJS.Workbook();
    perfiles.forEach((p, i) => agregarTablaSintetica(w.addWorksheet(`Hoja demo ${i + 1}`), p));
    editar?.(w);
    return Buffer.from(await w.xlsx.writeBuffer());
}

/** Estructura comunicada en auditoría; valores y posiciones son representativos,
 * no una copia de los Excel reales, que no están disponibles. */
export const hojasHalelRepresentativas = [
    { nombre: "Hoja1", fila: 4, columna: 1, fecha: "FechaFactura", factura: "NRO. DE FACTURA" },
    { nombre: "LOTE 2048", fila: 8, columna: 1, fecha: "FECHA", factura: "NO. FACTURA" },
    { nombre: "LOTE 2054", fila: 37, columna: 3, fecha: "FechaFactura", factura: "NO. FACTURA" },
    { nombre: "LOTE 2058", fila: 12, columna: 2, fecha: "FECHA", factura: "NRO. DE FACTURA" },
] as const;

export async function fixtureHalelCuatroHojas(editar?: (w: ExcelJS.Workbook) => void) {
    return archivoDeteccion([], w => {
        for (const [i, config] of hojasHalelRepresentativas.entries()) {
            const s = w.addWorksheet(config.nombre), c = config.columna, f = config.fila;
            s.getCell("A1").value = "Reporte representativo sintético";
            s.getCell("A2").value = i ? config.nombre : "LOTE 2048";
            for (const [fila, sufijo] of [[f, "A"], [f + 8, "B"]] as const) {
                agregarTablaSintetica(s, "HALEL", fila, c);
                s.getCell(fila, c).value = config.fecha;
                s.getCell(fila, c + 9).value = config.factura;
                s.getCell(fila + 1, c + 2).value = `DEMO-${i}-${sufijo}`;
            }
            // Sin vale/placa: resúmenes auxiliares con etiquetas y valor/fórmula.
            for (const [fila, rotulo] of [[f + 3, "TOTAL"], [f + 4, "SUB TOTAL:"], [f + 5, "LIQUIDACIÓN"]] as const) {
                s.getCell(fila, c).value = rotulo;
                s.getCell(fila, c + 3).value = "Galones";
                s.getCell(fila, c + 4).value = "Precio";
                s.getCell(fila, c + 5).value = "Costo Total";
                s.getCell(fila, c + 7).value = "FECHA";
                s.getCell(fila, c + 10).value = rotulo === "LIQUIDACIÓN" ? 400 : { formula: `SUM(${s.getCell(f + 1, c + 5).address})`, result: 400 };
            }
            // Otra fila auxiliar: fecha e importe aislados, sin contexto de consumo.
            s.getCell(f + 6, c).value = new Date("2026-10-01T00:00:00Z");
            s.getCell(f + 6, c + 1).value = 400;
        }
        editar?.(w);
    });
}

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

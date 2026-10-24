import ExcelJS from "exceljs";
import { ErrorArchivoProveedor, validarArchivoImportacion, validarContenedorXlsx } from "../combustible-importacion-parser";
import { leerOoxmlProveedor } from "../combustible-ooxml-v2";
import { encabezadoProveedorV2, normalizarEncabezadoProveedorV2, textoCeldaProveedorV2 } from "../combustible-importacion-v2";
import type { PerfilProveedor } from "../combustible-importacion-v2-types";

/** Solo encabezados/estructura; nunca nombre de archivo, proveedor o valores de consumos.
 * El parser existente conserva las reglas de fórmulas, importes y elegibilidad. */
export async function detectarFormatoCB2(buffer: Buffer): Promise<PerfilProveedor> {
    validarArchivoImportacion({ name: "reporte.xlsx", size: buffer.length });
    validarContenedorXlsx(buffer);
    leerOoxmlProveedor(buffer); // límites reales del ZIP/XML antes de cargar ExcelJS
    const libro = new ExcelJS.Workbook();
    try { await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer); }
    catch { throw new ErrorArchivoProveedor("Excel dañado o incompatible."); }
    if (libro.worksheets.length > 20) throw new ErrorArchivoProveedor("Máximo 20 hojas.", 413);
    const formatos = new Set<PerfilProveedor>();
    let posiciones = 0;
    const indicios = new Set(["FECHA", "FECHAFACTURA", "VALE", "NOVALE", "PLACA", "PLACAS", "GLS", "GALONES", "MONTO", "COSTOTOTAL", "PRECIO", "KM", "KILOMETRAJE", "PILOTO"]);
    for (const hoja of libro.worksheets) {
        if (hoja.rowCount > 5000 || hoja.columnCount > 100 || (posiciones += hoja.rowCount) > 10000)
            throw new ErrorArchivoProveedor("Máximo 10,000 filas, 5,000 por hoja y 100 columnas.", 413);
        for (let n = 1; n <= hoja.rowCount; n++) {
            const fila = hoja.getRow(n), tokens = new Set<string>();
            fila.eachCell(c => { if (c.type !== ExcelJS.ValueType.Formula && c.master.address === c.address) tokens.add(normalizarEncabezadoProveedorV2(textoCeldaProveedorV2(c))); });
            const columnas = encabezadoProveedorV2(fila);
            if (!columnas) {
                if ([...tokens].filter(t => indicios.has(t)).length >= 4)
                    throw new ErrorArchivoProveedor("Hay un encabezado incompleto o no compatible. Revisa las columnas HALEL/SHELL del archivo.");
                continue; // títulos, lotes, notas y hojas sin tablas reconocibles
            }
            const comunes = columnas.piloto && columnas.serie && columnas.factura;
            const shell = comunes && tokens.has("GLS") && tokens.has("MONTO") && !!columnas.producto;
            const halel = comunes && tokens.has("GALONES") && tokens.has("COSTOTOTAL") && !!columnas.km;
            if ((!shell && !halel) || (shell && halel))
                throw new ErrorArchivoProveedor("No se pudo distinguir claramente el formato HALEL o SHELL. Revisa los encabezados; no se utilizará un perfil supuesto.");
            formatos.add(shell ? "SHELL" : "HALEL");
            if (formatos.size > 1)
                throw new ErrorArchivoProveedor("El Excel mezcla formatos HALEL y SHELL incompatibles, en una o varias hojas. Sepáralos en archivos independientes.");
        }
    }
    if (!formatos.size) throw new ErrorArchivoProveedor("No se reconoce un formato HALEL o SHELL claro. Revisa los encabezados del Excel.");
    return [...formatos][0];
}

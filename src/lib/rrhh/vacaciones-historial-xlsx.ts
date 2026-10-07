import ExcelJS from "exceljs";
import type { FilaCruda } from "./vacaciones-historial-import";

/** Valor de celda de exceljs → primitivo (texto, número o Date) para el normalizador. Fórmulas: su resultado. */
function valorCelda(v: unknown): unknown {
  if (v == null) return "";
  if (v instanceof Date || typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[]; hyperlink?: string };
  if (o.result !== undefined) return valorCelda(o.result);
  if (Array.isArray(o.richText)) return o.richText.map((t) => t.text).join("");
  if (o.text !== undefined) return String(o.text);
  return "";
}

/** Lee la PRIMERA hoja de un .xlsx: fila 1 = encabezados; filas vacías se omiten. Solo lee: no escribe nada en ninguna parte. */
export async function leerXlsx(contenido: ArrayBuffer | Buffer): Promise<{ encabezados: string[]; filas: FilaCruda[] }> {
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(contenido as ArrayBuffer);
  const hoja = libro.worksheets[0];
  if (!hoja) return { encabezados: [], filas: [] };
  const cab = hoja.getRow(1);
  const encabezados: string[] = [];
  for (let c = 1; c <= hoja.columnCount; c++) encabezados.push(String(valorCelda(cab.getCell(c).value)).trim());
  const filas: FilaCruda[] = [];
  for (let r = 2; r <= hoja.rowCount; r++) {
    const row = hoja.getRow(r);
    const valores: Record<string, unknown> = {};
    let hayDatos = false;
    encabezados.forEach((h, i) => {
      if (!h) return;
      const v = valorCelda(row.getCell(i + 1).value);
      valores[h] = typeof v === "string" ? v.trim() : v;
      if (v !== "" && v != null) hayDatos = true;
    });
    if (hayDatos) filas.push({ fila: r, valores });
  }
  return { encabezados, filas };
}

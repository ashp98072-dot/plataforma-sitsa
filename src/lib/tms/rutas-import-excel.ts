import ExcelJS from "exceljs";

/**
 * VIAT-5 (Operaciones > Rutas > Importar Excel) — lector de la hoja
 * "CODIGOS DATA" del Excel operativo real. Reutiliza ExcelJS (ya es
 * dependencia del proyecto, ver src/lib/rrhh/export-files.ts) — no se
 * agrega ninguna dependencia nueva. Mismo estilo de helpers (cellStr,
 * normalizarHora) que src/lib/rrhh/marcajes-import-excel.ts, pero sin
 * importarlos de ahí (son privados a ese módulo) y sin tocar ese archivo
 * — Rutas no depende de RRHH.
 *
 * Formato REAL confirmado (VIAT-4b): la hoja no tiene encabezados de
 * texto — la fila 1 son marcadores numéricos y los datos empiezan en la
 * fila 2, en columnas fijas C..H:
 *   C = Código, D = Cliente, E = Lugar de carga, F = Hora,
 *   G = Contacto, H = Destino (descripción completa, texto libre).
 * Solo se LEEN valores (cell.value / cell.text) — ExcelJS nunca ejecuta
 * fórmulas; si una celda es fórmula, se toma su resultado cacheado
 * (`.result`), nunca se evalúa nada del lado del servidor.
 */

export type FilaRutaExcel = {
  filaExcel: number;
  codigoExcel: string;
  clienteExcel: string;
  lugarCargaExcel: string;
  horaExcel: string | null;
  contactoExcel: string;
  destinoExcel: string;
};

const COL_CODIGO = 3; // C
const COL_CLIENTE = 4; // D
const COL_LUGAR_CARGA = 5; // E
const COL_HORA = 6; // F
const COL_CONTACTO = 7; // G
const COL_DESTINO = 8; // H
const FILA_INICIO_DATOS = 2;

function cellStr(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const obj = value as { result?: unknown; text?: string; richText?: { text: string }[] };
    if (obj.result != null) return cellStr(obj.result);
    if (typeof obj.text === "string") return obj.text.trim();
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("").trim();
  }
  return String(value).trim();
}

function segundosAHora(segundos: number): string {
  const normalized = ((Math.round(segundos) % 86400) + 86400) % 86400;
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Igual criterio que marcajes-import-excel.ts: acepta Date, fracción de día (Excel time) o texto HH:MM(:SS). */
function normalizarHora(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const fraccion = value >= 0 && value < 1 ? value : value - Math.floor(value);
    if (fraccion >= 0 && fraccion < 1) return segundosAHora(fraccion * 86400);
  }
  const raw = cellStr(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return raw.length <= 20 ? raw : null; // texto no-hora estándar: se conserva tal cual, no se descarta
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Lee "CODIGOS DATA" y devuelve una fila por registro (código/cliente/
 * lugar de carga/hora/contacto/destino), en el mismo orden del archivo.
 * Lanza un error claro si la hoja no existe.
 *
 * Solo se incluyen filas con un valor en la columna Código (C). Verificado
 * contra el Excel real ("PROGRAMACION AGOSTO 2026 ACTUALIZADA.xlsx"): la
 * hoja "CODIGOS DATA" tiene el catálogo real en un bloque contiguo (147
 * códigos únicos, 0 duplicados, coincide exactamente con el conteo
 * reportado), pero MÁS ABAJO en la misma hoja hay un bloque de ~1500 filas
 * completamente ajeno al catálogo (otra tabla, sin relación con rutas) que
 * por coincidencia reutiliza las mismas columnas D..H. Ese bloque no tiene
 * código en la columna C — filtrar por "código no vacío" excluye ese ruido
 * sin perder ningún registro real (una fila sin código nunca fue un
 * registro de ruta: el código es su identificador).
 */
export async function parsearExcelRutas(buffer: Buffer): Promise<FilaRutaExcel[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const ws =
    wb.getWorksheet("CODIGOS DATA") ??
    wb.getWorksheet("Codigos Data") ??
    wb.worksheets.find((w) => w.name.trim().toUpperCase() === "CODIGOS DATA");

  if (!ws) {
    throw new Error('No se encontró la hoja "CODIGOS DATA" en el archivo.');
  }

  const filas: FilaRutaExcel[] = [];
  for (let rowIndex = FILA_INICIO_DATOS; rowIndex <= ws.rowCount; rowIndex++) {
    const row = ws.getRow(rowIndex);
    const codigoExcel = cellStr(row.getCell(COL_CODIGO).value);
    const clienteExcel = cellStr(row.getCell(COL_CLIENTE).value);
    const lugarCargaExcel = cellStr(row.getCell(COL_LUGAR_CARGA).value);
    const horaExcel = normalizarHora(row.getCell(COL_HORA).value);
    const contactoExcel = cellStr(row.getCell(COL_CONTACTO).value);
    const destinoExcel = cellStr(row.getCell(COL_DESTINO).value);

    if (!codigoExcel.trim()) continue;

    filas.push({
      filaExcel: rowIndex,
      codigoExcel: codigoExcel.trim(),
      clienteExcel: clienteExcel.trim(),
      lugarCargaExcel: lugarCargaExcel.trim(),
      horaExcel,
      contactoExcel: contactoExcel.trim(),
      // Destino: se conserva EXACTO tal como viene del Excel — no se
      // recorta, no se separa por guiones, no se altera ninguna
      // abreviatura (punto 6 de VIAT-5).
      destinoExcel,
    });
  }
  return filas;
}

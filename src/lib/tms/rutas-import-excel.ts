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
  tarifaReferenciaExcel: number | null;
  pilotoCodigoExcel: string;
  pilotoViaticoExcel: number | null;
  auxiliaresCodigosExcel: string[];
  auxiliaresViaticosExcel: (number | null)[];
  erroresCamposExcel: string[];
};

const COL_CODIGO = 3; // C
const COL_CLIENTE = 4; // D
const COL_LUGAR_CARGA = 5; // E
const COL_HORA = 6; // F
const COL_CONTACTO = 7; // G
const COL_DESTINO = 8; // H
const COL_TARIFA = 9; // I
const COL_PILOTO = 10; // J
const COL_VIATICO_PILOTO = 11; // K
const COL_AUXILIARES = 12; // L
const COL_VIATICOS_AUXILIARES = 13; // M
const FILA_INICIO_DATOS = 2;

export async function generarPlantillaRutas(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SITSA Plataforma";
  wb.subject = "Modelo para importación masiva de rutas";
  const ws = wb.addWorksheet("CODIGOS DATA", {
    views: [{ state: "frozen", ySplit: 2, showGridLines: true, zoomScale: 85 }],
    properties: { tabColor: { argb: "FF1F4E78" } },
  });
  // Replica la fila 1 del archivo operativo PROGRAMACION AGOSTO 2026
  // ACTUALIZADA.xlsx: marcadores 1..6 en las columnas históricas C..H.
  // La fila 2 agrega los nombres de campo que el archivo original no tenía,
  // sin mover ni cambiar las columnas que consume el importador.
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].forEach((value, index) => {
    ws.getCell(1, COL_CODIGO + index).value = value;
  });
  ws.getRow(1).font = { name: "Calibri", size: 12, bold: true };
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 20;

  const encabezados = [
    "Código de ruta *",
    "Cliente *",
    "Lugar de carga",
    "Hora habitual",
    "Contacto",
    "Destino / lugar de descarga",
    "Tarifa referencia (Q)",
    "Código piloto habitual",
    "Viático piloto (Q)",
    "Códigos auxiliares",
    "Viáticos auxiliares (Q)",
  ];
  encabezados.forEach((value, index) => {
    ws.getCell(2, COL_CODIGO + index).value = value;
  });
  ws.getRow(2).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.getRow(2).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  ws.getRow(2).height = 34;
  ws.getColumn("A").width = 2;
  ws.getColumn("B").width = 8;
  ws.getColumn("C").width = 14;
  ws.getColumn("D").width = 28;
  ws.getColumn("E").width = 60;
  ws.getColumn("F").width = 13;
  ws.getColumn("G").width = 24;
  ws.getColumn("H").width = 58;
  ws.getColumn("I").width = 20;
  ws.getColumn("J").width = 23;
  ws.getColumn("K").width = 20;
  ws.getColumn("L").width = 28;
  ws.getColumn("M").width = 28;
  ws.getColumn("C").numFmt = "@";
  ws.getColumn("F").numFmt = "h:mm";
  ws.getCell("F1").numFmt = "General";
  ws.getCell("F2").numFmt = "General";
  ws.getColumn("I").numFmt = "Q#,##0.00";
  ws.getColumn("K").numFmt = "Q#,##0.00";
  ws.autoFilter = { from: "C2", to: "M2000" };

  // Ejemplo visible que el importador ignora expresamente. El usuario puede
  // conservarlo: solo debe empezar sus rutas en las filas siguientes.
  ws.getRow(3).values = [
    null, null,
    "EJEMPLO-NO-IMPORTAR",
    "CALSA",
    "BODEGAS CALSA, ZONA 12",
    3 / 24,
    "Herbert Santiso",
    "BODEGAS DE CONRED, ZONA 13",
    1250,
    "2653895771220",
    150,
    "1857985511603;3062587490311",
    "75;75",
  ];
  ws.getRow(3).font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF595959" } };
  ws.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  ws.getRow(3).alignment = { vertical: "middle", wrapText: true };
  ws.getRow(3).height = 32;
  ws.getCell("F3").numFmt = "h:mm";
  ws.getCell("F3").alignment = { vertical: "middle", horizontal: "center" };
  ws.getCell("F4").dataValidation = {
    type: "decimal", operator: "between", allowBlank: true,
    formulae: [0, 0.99999],
    showInputMessage: true,
    promptTitle: "Hora habitual",
    prompt: "Escriba una hora válida, por ejemplo 03:00 o 14:30.",
    showErrorMessage: true,
    errorTitle: "Hora no válida",
    error: "Use una hora válida entre 00:00 y 23:59.",
  };
  for (let fila = 5; fila <= 2000; fila++) {
    ws.getCell(fila, COL_HORA).dataValidation = ws.getCell("F4").dataValidation;
  }

  const ayuda = wb.addWorksheet("AYUDA", {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
    properties: { tabColor: { argb: "FF70AD47" } },
  });
  ayuda.getCell("A1").value = "CÓMO IMPORTAR RUTAS DE FORMA MASIVA";
  ayuda.getRow(1).font = { bold: true, size: 15, color: { argb: "FF1F1F1F" } };
  ayuda.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAF7" } };
  ayuda.getRow(1).alignment = { vertical: "middle" };
  ayuda.getRow(1).height = 38;
  ayuda.getCell("A2").value = "Llene una ruta por fila en la hoja CODIGOS DATA. Los campos con * son obligatorios.";
  ayuda.getRow(2).alignment = { wrapText: true, vertical: "middle" };
  ayuda.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAF7" } };
  ayuda.getRow(3).values = ["Campo", "Qué debe escribir"];
  ayuda.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ayuda.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4472C4" } };
  [
    ["Código de ruta *", "Identificador único de la ruta, por ejemplo 1001 o RUTA-001. No repita un código dentro del archivo."],
    ["Cliente *", "Nombre del cliente tal como aparece en el catálogo de Clientes. Si no coincide, podrá resolverlo durante la previsualización."],
    ["Lugar de carga", "Dirección o descripción habitual donde se recoge la carga."],
    ["Hora habitual", "Hora usual de salida o carga. Ejemplos: 03:00, 08:30 o 14:00."],
    ["Contacto", "Nombre de la persona de contacto para coordinar la operación."],
    ["Destino / lugar de descarga", "Dirección o descripción completa del destino habitual."],
    ["Tarifa referencia (Q)", "Tarifa comercial promedio o de referencia de la ruta. Es opcional y puede ajustarse al programar cada viaje."],
    ["Código piloto habitual", "Código RRHH del piloto que normalmente cubre la ruta. Opcional."],
    ["Viático piloto (Q)", "Monto habitual del viático para el piloto de esta ruta. Opcional."],
    ["Códigos auxiliares", "Códigos RRHH de los auxiliares habituales separados por punto y coma (;). Máximo 8."],
    ["Viáticos auxiliares (Q)", "Montos en el mismo orden que los códigos de auxiliares, separados por punto y coma (;)."],
    ["Reimportación", "En una ruta existente, dejar tarifa/personal vacío significa CONSERVAR los defaults actuales. Para reemplazar personal, informe los códigos y marque Actualizar."],
    ["Fila 1: números 1 a 6", "Conserva la estructura del archivo PROGRAMACION AGOSTO 2026 ACTUALIZADA.xlsx y la posición histórica de cada dato."],
    ["Fila azul", "Muestra el nombre claro de cada campo. No la elimine ni mueva las columnas."],
    ["Fila amarilla", "Es únicamente un ejemplo y NO se importará. Empiece a ingresar sus rutas debajo de esa fila."],
    ["Antes de importar", "No cambie el nombre de la hoja CODIGOS DATA, no elimine columnas y no mueva los campos de las columnas C a H."],
    ["Proceso", "1) Descargue este formato. 2) Llene una ruta por fila. 3) Guarde como .xlsx. 4) Cárguelo y pulse Previsualizar. 5) Revise los resultados antes de confirmar."],
  ].forEach((row) => ayuda.addRow(row));
  ayuda.columns = [{ width: 31 }, { width: 105 }];
  ayuda.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  ayuda.getColumn(1).font = { bold: true };
  ayuda.getRow(2).font = { bold: false };
  ayuda.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ayuda.getRow(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  ayuda.getRow(13).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function numeroOpcional(value: unknown, campo: string): { valor: number | null; error: string | null } {
  if (value == null || value === "" || cellStr(value).trim() === "") return { valor: null, error: null };
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? { valor: value, error: null }
      : { valor: null, error: `${campo}: usa un número mayor o igual a cero.` };
  }
  const raw = cellStr(value).replace(/[Q,$\s]/g, "").replace(/,/g, "");
  if (!raw) return { valor: null, error: `${campo}: monto inválido.` };
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0
    ? { valor: parsed, error: null }
    : { valor: null, error: `${campo}: usa un número mayor o igual a cero.` };
}

function listaTexto(value: unknown): string[] {
  return cellStr(value).split(";").map((v) => v.trim()).filter(Boolean);
}

function listaMontos(value: unknown): { valores: (number | null)[]; errores: string[] } {
  const raw = cellStr(value);
  if (!raw.trim()) return { valores: [], errores: [] };
  const errores: string[] = [];
  const valores = raw.split(";").map((v, index) => {
    const parsed = numeroOpcional(v, `Viático auxiliar ${index + 1}`);
    if (parsed.error) errores.push(parsed.error);
    return parsed.valor;
  });
  return { valores, errores };
}

/** trim + colapsar espacios + minúsculas — solo para comparar contra encabezados conocidos. */
function normalizarTexto(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// Confirmado contra un preview real en producción: la hoja "CODIGOS DATA"
// tiene, más abajo del catálogo, una fila que repite literalmente el
// encabezado de columnas (Código/Cliente/Lugar de Carga/Hora/Contacto/
// Lugar de Descarga) en vez de datos reales. Como Código no está vacío
// ("Codigo"), antes se colaba como si fuera una ruta válida. Se descarta
// por el valor exacto de la columna Código, sin depender de las demás
// columnas (más robusto ante variaciones de esa fila repetida).
const CODIGOS_ENCABEZADO = new Set(["codigo", "código", "codigo de ruta *", "código de ruta *"]);
const CODIGOS_EJEMPLO = new Set(["ejemplo-no-importar", "ejemplo_no_importar"]);

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
 * Solo se incluyen filas con un valor en la columna Código (C), y no un
 * encabezado repetido (ver CODIGOS_ENCABEZADO). Verificado contra el
 * Excel real ("PROGRAMACION AGOSTO 2026 ACTUALIZADA.xlsx"): la hoja
 * "CODIGOS DATA" tiene el catálogo real en un bloque contiguo, pero MÁS
 * ABAJO en la misma hoja hay un bloque de ~1500 filas completamente ajeno
 * al catálogo (otra tabla, sin relación con rutas) que por coincidencia
 * reutiliza las mismas columnas D..H, y una fila que repite el encabezado
 * de columnas en vez de datos. Filtrar por "código no vacío y no
 * encabezado" excluye ambos sin perder ningún registro real (una fila sin
 * código, o con el texto del encabezado, nunca fue un registro de ruta).
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
    const tarifa = numeroOpcional(row.getCell(COL_TARIFA).value, "Tarifa de referencia");
    const pilotoCodigoExcel = cellStr(row.getCell(COL_PILOTO).value);
    const pilotoViatico = numeroOpcional(row.getCell(COL_VIATICO_PILOTO).value, "Viático del piloto");
    const auxiliaresCodigosExcel = listaTexto(row.getCell(COL_AUXILIARES).value);
    const auxiliaresViaticos = listaMontos(row.getCell(COL_VIATICOS_AUXILIARES).value);
    const erroresCamposExcel = [tarifa.error, pilotoViatico.error, ...auxiliaresViaticos.errores].filter(
      (error): error is string => Boolean(error),
    );
    if (pilotoViatico.valor != null && !pilotoCodigoExcel.trim()) {
      erroresCamposExcel.push("No puede informar viático de piloto sin código de piloto habitual.");
    }
    if (auxiliaresViaticos.valores.length && auxiliaresViaticos.valores.length !== auxiliaresCodigosExcel.length) {
      erroresCamposExcel.push("La cantidad de viáticos debe coincidir con la cantidad de auxiliares.");
    }

    const codigoTrim = codigoExcel.trim();
    if (!codigoTrim) continue;
    if (CODIGOS_ENCABEZADO.has(normalizarTexto(codigoTrim))) continue; // fila de encabezado repetido, no es una ruta
    if (CODIGOS_EJEMPLO.has(normalizarTexto(codigoTrim))) continue; // fila ilustrativa de la plantilla oficial

    filas.push({
      filaExcel: rowIndex,
      codigoExcel: codigoTrim,
      clienteExcel: clienteExcel.trim(),
      lugarCargaExcel: lugarCargaExcel.trim(),
      horaExcel,
      contactoExcel: contactoExcel.trim(),
      // Destino: se conserva EXACTO tal como viene del Excel — no se
      // recorta, no se separa por guiones, no se altera ninguna
      // abreviatura (punto 6 de VIAT-5).
      destinoExcel,
      tarifaReferenciaExcel: tarifa.valor,
      pilotoCodigoExcel: pilotoCodigoExcel.trim(),
      pilotoViaticoExcel: pilotoViatico.valor,
      auxiliaresCodigosExcel,
      auxiliaresViaticosExcel: auxiliaresViaticos.valores,
      erroresCamposExcel,
    });
  }
  return filas;
}

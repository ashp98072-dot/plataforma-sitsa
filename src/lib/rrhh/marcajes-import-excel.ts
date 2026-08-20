import ExcelJS from "exceljs";

export type FilaMarcajeExcel = {
  filaExcel: number;
  numeroEmpleado: string;
  fecha: string;
  entrada: string | null;
  salida: string | null;
  observacion: string | null;
};

export const HEADERS_MARCAJES = [
  "numero_empleado",
  "fecha",
  "entrada",
  "salida",
  "observacion",
] as const;

export async function generarPlantillaMarcajes(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet("Marcajes");

  ws.addRow([...HEADERS_MARCAJES]);
  ws.getRow(1).font = { bold: true };

  ws.addRow([
    "000009",
    "2026-08-20",
    "07:00:00",
    "16:00:00",
    "Ejemplo de entrada y salida",
  ]);

  ws.addRow([
    "000028",
    "2026-08-20",
    "07:05:00",
    "",
    "Ejemplo solo entrada",
  ]);

  ws.columns = [
    { width: 20 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 45 },
  ];

  const ayuda = wb.addWorksheet("Ayuda");

  ayuda.addRow(["Campo", "Descripción"]);
  ayuda.getRow(1).font = { bold: true };

  ayuda.addRow([
    "numero_empleado",
    "Número global del empleado. Ejemplo: 000009.",
  ]);

  ayuda.addRow([
    "fecha",
    "Fecha de la jornada. Preferido: YYYY-MM-DD. También acepta DD/MM/YYYY.",
  ]);

  ayuda.addRow([
    "entrada",
    "Hora de entrada. HH:MM o HH:MM:SS.",
  ]);

  ayuda.addRow([
    "salida",
    "Hora de salida. Puede quedar vacía si la jornada continúa abierta.",
  ]);

  ayuda.addRow([
    "observacion",
    "Texto opcional para indicar el motivo u origen del registro.",
  ]);

  ayuda.addRow([
    "Importante",
    "La importación NO reemplaza silenciosamente marcajes existentes.",
  ]);

  ayuda.addRow([
    "Registros existentes",
    "Solo se completarán campos faltantes cuando sea seguro hacerlo.",
  ]);

  ayuda.columns = [
    { width: 24 },
    { width: 75 },
  ];

  return Buffer.from(
    await wb.xlsx.writeBuffer(),
  );
}

function cellStr(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value).trim();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "object") {
    const obj = value as {
      result?: unknown;
      text?: string;
      richText?: { text: string }[];
    };

    if (obj.result != null) {
      return cellStr(obj.result);
    }

    if (typeof obj.text === "string") {
      return obj.text.trim();
    }

    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((r) => r.text)
        .join("")
        .trim();
    }
  }

  return String(value).trim();
}

function normalizarHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, "_")
    .trim();
}

function excelSerialAFecha(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) {
    return null;
  }

  const dias = Math.floor(serial);

  const fecha = new Date(
    Date.UTC(1899, 11, 30) +
      dias * 86400000,
  );

  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const d = String(fecha.getUTCDate()).padStart(2, "0");

  return `${y}-${m}-${d}`;
}

function normalizarFecha(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");

    return `${y}-${m}-${d}`;
  }

  if (typeof value === "number") {
    return excelSerialAFecha(value);
  }

  const raw = cellStr(value).trim();

  if (!raw) return null;

  const iso = raw.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
  );

  if (iso) {
    const y = iso[1];
    const m = iso[2].padStart(2, "0");
    const d = iso[3].padStart(2, "0");

    return `${y}-${m}-${d}`;
  }

  const latam = raw.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/,
  );

  if (latam) {
    const d = latam[1].padStart(2, "0");
    const m = latam[2].padStart(2, "0");
    const y = latam[3];

    return `${y}-${m}-${d}`;
  }

  return null;
}

function segundosAHora(segundos: number): string {
  const normalized =
    ((Math.round(segundos) % 86400) + 86400) % 86400;

  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  const s = normalized % 60;

  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].join(":");
}

function normalizarHora(value: unknown): string | null {
  if (value == null || value === "") {
    return null;
  }

  if (value instanceof Date) {
    return [
      String(value.getUTCHours()).padStart(2, "0"),
      String(value.getUTCMinutes()).padStart(2, "0"),
      String(value.getUTCSeconds()).padStart(2, "0"),
    ].join(":");
  }

  if (typeof value === "number") {
    if (value >= 0 && value < 1) {
      return segundosAHora(value * 86400);
    }

    const fraccion = value - Math.floor(value);

    if (fraccion >= 0 && fraccion < 1) {
      return segundosAHora(fraccion * 86400);
    }
  }

  const raw = cellStr(value).trim();

  if (!raw) return null;

  const match = raw.match(
    /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
  );

  if (!match) {
    return null;
  }

  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] ?? "0");

  if (
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59 ||
    s < 0 ||
    s > 59
  ) {
    return null;
  }

  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0"),
  ].join(":");
}

export async function parsearExcelMarcajes(
  buffer: Buffer,
): Promise<FilaMarcajeExcel[]> {
  const wb = new ExcelJS.Workbook();

  await wb.xlsx.load(
    buffer as unknown as ExcelJS.Buffer,
  );

  const ws =
    wb.getWorksheet("Marcajes") ??
    wb.getWorksheet("MARCAJES") ??
    wb.worksheets[0];

  if (!ws) {
    return [];
  }

  let headerRow = 0;
  const headerMap = new Map<string, number>();

  for (
    let rowIndex = 1;
    rowIndex <= Math.min(10, ws.rowCount);
    rowIndex += 1
  ) {
    const row = ws.getRow(rowIndex);
    const temp = new Map<string, number>();

    row.eachCell(
      { includeEmpty: false },
      (cell, col) => {
        const header = normalizarHeader(
          cellStr(cell.value),
        );

        if (header) {
          temp.set(header, col);
        }
      },
    );

    const tieneEmpleado =
      temp.has("numero_empleado") ||
      temp.has("numero_de_empleado") ||
      temp.has("no_empleado");

    const tieneFecha = temp.has("fecha");

    if (tieneEmpleado && tieneFecha) {
      headerRow = rowIndex;

      for (const [key, col] of temp) {
        headerMap.set(key, col);
      }

      break;
    }
  }

  if (!headerRow) {
    throw new Error(
      "No se encontraron los encabezados numero_empleado y fecha.",
    );
  }

  function columna(...nombres: string[]): number {
    for (const nombre of nombres) {
      const col = headerMap.get(
        normalizarHeader(nombre),
      );

      if (col) return col;
    }

    return 0;
  }

  const cNumero = columna(
    "numero_empleado",
    "numero de empleado",
    "no empleado",
  );

  const cFecha = columna("fecha");
  const cEntrada = columna("entrada");
  const cSalida = columna("salida");

  const cObservacion = columna(
    "observacion",
    "observación",
    "comentario",
    "comentarios",
  );

  const filas: FilaMarcajeExcel[] = [];

  for (
    let rowIndex = headerRow + 1;
    rowIndex <= ws.rowCount;
    rowIndex += 1
  ) {
    const row = ws.getRow(rowIndex);

    const numeroEmpleado = cNumero
      ? cellStr(row.getCell(cNumero).value)
      : "";

    const fechaValue = cFecha
      ? row.getCell(cFecha).value
      : null;

    const entradaValue = cEntrada
      ? row.getCell(cEntrada).value
      : null;

    const salidaValue = cSalida
      ? row.getCell(cSalida).value
      : null;

    const observacion = cObservacion
      ? cellStr(row.getCell(cObservacion).value)
      : "";

    const completamenteVacia =
      !numeroEmpleado.trim() &&
      fechaValue == null &&
      entradaValue == null &&
      salidaValue == null &&
      !observacion.trim();

    if (completamenteVacia) {
      continue;
    }

    filas.push({
      filaExcel: rowIndex,
      numeroEmpleado: numeroEmpleado.trim(),
      fecha: normalizarFecha(fechaValue) ?? "",
      entrada: normalizarHora(entradaValue),
      salida: normalizarHora(salidaValue),
      observacion: observacion.trim() || null,
    });
  }

  return filas;
}
import ExcelJS from "exceljs";
import type { Clasificacion, Periodicidad } from "@/lib/rrhh/descuentos";

export type FilaDescuentoExcel = {
  filaExcel: number;
  codigoEmpleado: string;
  dpi: string;
  concepto: string;
  motivo: string;
  clasificacion: Clasificacion | "";
  montoOriginal: number;
  periodicidad: Periodicidad | "";
  numeroCuotas: number;
  fechaInicio: string;
  cadaNQuincenas: number | null;
  documentoId: number | null;
  autorizar: boolean;
};

const headers = [
  "codigo_empleado", "dpi", "concepto", "motivo", "clasificacion",
  "monto_total", "periodicidad", "numero_cuotas", "fecha_inicio",
  "cada_n_quincenas", "documento_id", "autorizar",
] as const;

export async function generarPlantillaDescuentos(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SITSA Plataforma";
  const ws = wb.addWorksheet("IMPORTAR");
  ws.addRow([...headers]);
  ws.addRow([
    "000009", "", "Préstamo", "Compra de equipo autorizado", "AUTORIZADO",
    600, "Cada quincena", 4, "2026-09-01", "", "", "SI",
  ]);
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = "A1:L1";
  ws.columns = [18, 18, 24, 40, 18, 16, 26, 16, 16, 20, 16, 14].map((width) => ({ width }));
  ws.getColumn(6).numFmt = '"Q"#,##0.00';
  ws.getColumn(9).numFmt = "yyyy-mm-dd";

  const ayuda = wb.addWorksheet("AYUDA");
  ayuda.addRow(["Campo", "Descripción"]);
  ayuda.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ayuda.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  [
    ["codigo_empleado / dpi", "Indique al menos uno. Debe identificar un colaborador activo de la empresa."],
    ["concepto", "Nombre corto del descuento."],
    ["motivo", "Explicación obligatoria para que Contabilidad sepa por qué se descuenta."],
    ["clasificacion", "LEGAL, AUTORIZADO, JUDICIAL o SISTEMA."],
    ["monto_total", "Monto total del descuento, mayor a cero."],
    ["periodicidad", "Una vez, Cada quincena, Primera quincena, Segunda quincena, Mensual, Cada N quincenas o Manual."],
    ["numero_cuotas", "Entre 1 y 60. Para Una vez o Manual se usa 1."],
    ["fecha_inicio", "Fecha YYYY-MM-DD o DD/MM/YYYY."],
    ["cada_n_quincenas", "Obligatorio solo para Cada N quincenas."],
    ["documento_id", "Opcional; obligatorio para autorizar descuentos JUDICIAL."],
    ["autorizar", "SI: activa y genera las cuotas. NO: crea el descuento en borrador."],
    ["Importante", "Primero use Validar Excel. La importación no modifica descuentos existentes y bloquea duplicados exactos."],
  ].forEach((row) => ayuda.addRow(row));
  ayuda.columns = [{ width: 28 }, { width: 95 }];
  ayuda.eachRow((row) => { row.alignment = { vertical: "top", wrapText: true }; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function texto(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as { result?: unknown; text?: string; richText?: { text: string }[] };
    if (v.result != null) return texto(v.result);
    if (typeof v.text === "string") return v.text.trim();
    if (Array.isArray(v.richText)) return v.richText.map((x) => x.text).join("").trim();
  }
  return String(value).trim();
}

function clave(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function fecha(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 0) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const raw = texto(value);
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const latam = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  return latam ? `${latam[3]}-${latam[2].padStart(2, "0")}-${latam[1].padStart(2, "0")}` : "";
}

function periodicidad(value: unknown): Periodicidad | "" {
  const v = clave(texto(value));
  const mapa: Record<string, Periodicidad> = {
    una_vez: "UNA_VEZ", cada_quincena: "CADA_QUINCENA",
    primera_quincena: "SOLO_QUINCENA_1", solo_primera_quincena: "SOLO_QUINCENA_1",
    segunda_quincena: "SOLO_QUINCENA_2", solo_segunda_quincena: "SOLO_QUINCENA_2",
    cada_n_quincenas: "CADA_N_QUINCENAS", mensual: "MENSUAL", manual: "MANUAL",
    una_vez_: "UNA_VEZ",
  };
  const tecnico = texto(value).toUpperCase() as Periodicidad;
  return mapa[v] ?? (["UNA_VEZ", "CADA_QUINCENA", "SOLO_QUINCENA_1", "SOLO_QUINCENA_2", "CADA_N_QUINCENAS", "MENSUAL", "MANUAL"].includes(tecnico) ? tecnico : "");
}

export async function parsearExcelDescuentos(buffer: Buffer): Promise<FilaDescuentoExcel[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet("IMPORTAR") ?? wb.getWorksheet("DESCUENTOS") ?? wb.worksheets[0];
  if (!ws) return [];
  const columnas = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => columnas.set(clave(texto(cell.value)), col));
  if (!columnas.has("concepto") || (!columnas.has("monto_total") && !columnas.has("total_descuento"))) {
    throw new Error("No se encontraron los encabezados concepto y monto_total. Usa la plantilla oficial o una exportación de Descuentos.");
  }
  const col = (...names: string[]) => names.map(clave).map((n) => columnas.get(n)).find(Boolean) ?? 0;
  const filas: FilaDescuentoExcel[] = [];
  for (let i = 2; i <= ws.rowCount; i += 1) {
    const row = ws.getRow(i);
    const valor = (...names: string[]) => { const c = col(...names); return c ? row.getCell(c).value : null; };
    const codigoEmpleado = texto(valor("codigo_empleado", "codigo"));
    const dpi = texto(valor("dpi"));
    const concepto = texto(valor("concepto"));
    const montoOriginal = Number(valor("monto_total", "monto_original", "total_descuento") ?? 0);
    if (!codigoEmpleado && !dpi && !concepto && !montoOriginal) continue;
    const clasificacionRaw = texto(valor("clasificacion")).toUpperCase();
    filas.push({
      filaExcel: i, codigoEmpleado, dpi, concepto,
      motivo: texto(valor("motivo", "observaciones", "porque", "motivo_por_que")),
      clasificacion: (["LEGAL", "AUTORIZADO", "JUDICIAL", "SISTEMA"].includes(clasificacionRaw) ? clasificacionRaw : "") as Clasificacion | "",
      montoOriginal, periodicidad: periodicidad(valor("periodicidad")),
      numeroCuotas: Math.trunc(Number(valor("numero_cuotas", "cuotas", "numero_de_cuotas") ?? 0)),
      fechaInicio: fecha(valor("fecha_inicio", "fecha", "fecha_de_inicio")),
      cadaNQuincenas: Number(valor("cada_n_quincenas") ?? 0) || null,
      documentoId: Number(valor("documento_id") ?? 0) || null,
      autorizar: ["si", "sí", "s", "1", "true"].includes(texto(valor("autorizar")).toLowerCase()),
    });
  }
  return filas;
}

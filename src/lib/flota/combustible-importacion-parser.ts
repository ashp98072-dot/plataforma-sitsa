import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { normalizarFechaExcel } from "./combustible-conciliacion";
import { MAX_UPLOAD_BYTES } from "@/lib/uploads-constants";
export class ErrorArchivoProveedor extends Error {
  constructor(message: string, public readonly status: 400 | 413 = 400) { super(message); }
}

export const PERFIL_HALEL = "HALEL";
export const VERSION_HALEL = 1;
export const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
export const hashImportacion = (valor: Buffer | string) => createHash("sha256").update(valor).digest("hex");
export type CampoImportacion = "fecha" | "placa" | "vale" | "galones" | "precio" | "total" | "km" | "piloto" | "serie" | "factura";
export type FilaImportada = {
  hoja: string; fila: number; estado: "VALIDA" | "ADVERTENCIA" | "INVALIDA" | "IGNORADA";
  motivos: string[]; textos: Record<CampoImportacion, string>; fechaReporte: string | null;
  placaNormalizada: string; valeNormalizado: string; galones: string | null; precio: string | null; total: string | null; kilometraje: string | null;
  fingerprint: string | null; claveOperacion: string | null; duplicado: "EXACTO" | "POSIBLE" | null;
  canonica: number | null; duplicadoPrevio: boolean;
  raw: { direccion: string; tipo: number; formato: string; valor: unknown }[];
};
export type AnalisisImportacion = { filas: FilaImportada[]; resumen: ReturnType<typeof resumirImportacion> };
export const normalizarIdentificador = (s: string) => s.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase();
export const normalizarPlacaImportada = (s: string) => normalizarIdentificador(s).replace(/[‐‑–—]/g, "-").replace(/\s*-\s*/g, "-");
const encabezado = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const aliases: Record<CampoImportacion, string[]> = {
  fecha: ["FECHA", "FECHAFACTURA", "FECHAREPORTE"], placa: ["PLACA", "PLACAS", "NODEPLACAS"],
  vale: ["VALE", "NOVALE", "NODEVALE", "VALENO", "NUMEROVALE"], galones: ["GALONES", "GLS"],
  precio: ["PRECIO", "PRECIOGALON"], total: ["COSTOTOTAL", "TOTAL", "MONTO"], km: ["KILOMETRAJE", "KM"],
  piloto: ["PILOTO", "NOMBREDELPILOTO"], serie: ["SERIE"], factura: ["NRODEFACTURA", "NOFACTURA", "NODEFACTURA", "FACTURA"],
};
const campos = Object.keys(aliases) as CampoImportacion[];
function texto(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && /^0+$/.test(cell.numFmt)) return String(v).padStart(cell.numFmt.length, "0");
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Fecha inválida" : v.toISOString();
  return cell.text;
}
function mapa(row: ExcelJS.Row) {
  const result: Partial<Record<CampoImportacion, number>> = {};
  let ambiguo = false;
  row.eachCell((cell, col) => {
    for (const campo of campos) if (aliases[campo].includes(encabezado(texto(cell)))) {
      if (result[campo] != null) ambiguo = true;
      result[campo] = col;
    }
  });
  return !ambiguo && result.vale && result.placa && (result.total || result.galones) ? result : null;
}
/** No interpreta separadores ambiguos como decimales por adivinación. Conserva el texto aparte. */
export function decimalImportado(s: string, escala: number, max = "999999999999.999999"): string | null {
  const limpio = s.trim().replace(/^Q\s*/i, "");
  if (!/^\d+(?:\.\d+)?$/.test(limpio) && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(limpio)) return null;
  const n = new Decimal(limpio.replace(/,/g, ""));
  return n.isFinite() && n.gte(0) && n.lte(max) && n.decimalPlaces() <= escala ? n.toFixed() : null;
}
/** Rechaza ZIP64/cifrados y cotas de expansión antes de ExcelJS. No extrae archivos. */
export function validarContenedorXlsx(buffer: Buffer) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw new ErrorArchivoProveedor("El archivo no es un .xlsx válido.");
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, buffer.length - 65557)) throw new ErrorArchivoProveedor("Archivo XLSX dañado.");
  const entradas = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16), expandido = 0;
  if (entradas > 2000 || entradas === 65535) throw new ErrorArchivoProveedor("El libro contiene demasiados objetos.", 413);
  for (let i = 0; i < entradas; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ErrorArchivoProveedor("Directorio XLSX inválido.");
    const size = buffer.readUInt32LE(offset + 24);
    expandido += size;
    if (size === 0xffffffff || expandido > 80 * 1024 * 1024 || (buffer.readUInt16LE(offset + 8) & 1)) throw new ErrorArchivoProveedor("Libro cifrado o demasiado grande al expandir.", 413);
    offset += 46 + buffer.readUInt16LE(offset + 28) + buffer.readUInt16LE(offset + 30) + buffer.readUInt16LE(offset + 32);
  }
}
export function validarArchivoImportacion(file: { name: string; type?: string; size: number }) {
  if (!/\.xlsx$/i.test(file.name)) throw new ErrorArchivoProveedor("Debes seleccionar un archivo .xlsx.");
  if (!file.size || file.size > MAX_UPLOAD_BYTES) throw new ErrorArchivoProveedor("Archivo vacío o superior al máximo de 50 MB.", 413);
  if (file.type && ![MIME_XLSX, "application/octet-stream", "application/zip"].includes(file.type)) throw new ErrorArchivoProveedor("MIME no permitido para Excel.");
}
export function resumirImportacion(filas: FilaImportada[]) {
  const operativas = filas.filter(f => f.estado !== "IGNORADA");
  return { filasOriginales: filas.length, encontradas: operativas.length,
    validas: operativas.filter(f => f.estado === "VALIDA").length, advertencias: operativas.filter(f => f.estado === "ADVERTENCIA").length,
    invalidas: operativas.filter(f => f.estado === "INVALIDA").length, ignoradas: filas.length - operativas.length,
    duplicadosInternos: operativas.filter(f => f.duplicado === "EXACTO").length,
    posiblesDuplicados: operativas.filter(f => f.duplicado === "POSIBLE").length,
    duplicadosPrevios: operativas.filter(f => f.duplicadoPrevio).length,
    operacionesUnicasEstimadas: new Set(operativas.filter(f => f.estado !== "INVALIDA" && f.fingerprint).map(f => f.fingerprint)).size };
}
export async function analizarExcelProveedor(buffer: Buffer): Promise<AnalisisImportacion> {
  validarArchivoImportacion({ name: "archivo.xlsx", size: buffer.length }); validarContenedorXlsx(buffer);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer); } catch { throw new ErrorArchivoProveedor("El archivo Excel está dañado o no es compatible."); }
  if (wb.worksheets.length > 20) throw new ErrorArchivoProveedor("Máximo 20 hojas por importación.", 413);
  const filas: FilaImportada[] = []; let reconocidas = 0, posiciones = 0, caracteres = 0;
  for (const ws of wb.worksheets) {
    if (ws.rowCount > 5000 || ws.columnCount > 100 || (posiciones += ws.rowCount) > 10000) throw new ErrorArchivoProveedor("Máximo 10,000 filas y 100 columnas; 5,000 filas por hoja.", 413);
    let columnas: ReturnType<typeof mapa> = null, header = 0;
    for (let i = 1; i <= Math.min(ws.rowCount, 25); i++) { const m = mapa(ws.getRow(i)); if (m) { columnas = m; header = i; reconocidas++; break; } }
    for (let i = 1; i <= ws.rowCount; i++) {
      const row = ws.getRow(i);
      const textos = Object.fromEntries(campos.map(c => [c, columnas?.[c] ? texto(row.getCell(columnas[c]!)) : ""])) as Record<CampoImportacion, string>;
      const raw: FilaImportada["raw"] = [];
      row.eachCell({ includeEmpty: false }, cell => raw.push({ direccion: cell.address, tipo: cell.type, formato: cell.numFmt, valor: cell.value }));
      const rawSize = JSON.stringify(raw).length; caracteres += rawSize;
      if (rawSize > 100000 || caracteres > 8 * 1024 * 1024) throw new ErrorArchivoProveedor("Demasiado contenido de celdas para una importación.", 413);
      const f: FilaImportada = { hoja: ws.name, fila: i, textos, raw, estado: "VALIDA", motivos: [], fechaReporte: null,
        placaNormalizada: normalizarPlacaImportada(textos.placa), valeNormalizado: normalizarIdentificador(textos.vale),
        galones: decimalImportado(textos.galones, 6), precio: decimalImportado(textos.precio, 6), total: decimalImportado(textos.total, 6), kilometraje: decimalImportado(textos.km, 3),
        fingerprint: null, claveOperacion: null, duplicado: null, canonica: null, duplicadoPrevio: false };
      if (!columnas || i <= header || mapa(row) || !raw.length || (!textos.vale.trim() && !textos.placa.trim()) || /^(TOTAL|SUBTOTAL)\b/i.test(textos.vale.trim()) || /^(TOTAL|SUBTOTAL)\b/i.test(textos.placa.trim())) {
        f.estado = "IGNORADA"; f.motivos.push(!columnas ? "Hoja sin encabezado reconocido" : i <= header || mapa(row) ? "Cabecera o preámbulo" : !raw.length ? "Fila vacía" : "Total, nota o fila sin vale/placa");
      } else {
        if (columnas.fecha) {
          const cell = row.getCell(columnas.fecha); let valor = cell.value;
          if (typeof valor === "number" && wb.properties.date1904) valor += 1462;
          f.fechaReporte = normalizarFechaExcel(valor);
        }
        if (!f.valeNormalizado || !f.placaNormalizada || !((f.total && new Decimal(f.total).gt(0)) || (f.galones && new Decimal(f.galones).gt(0)))) {
          f.estado = "INVALIDA"; f.motivos.push("Requiere vale, placa y monto o galones positivos.");
        }
        for (const c of ["galones", "precio", "total"] as const) if (textos[c].trim() && f[c] == null) f.motivos.push(`${c}: formato/precisión no reconocido`);
        if (!f.fechaReporte) f.motivos.push("Fecha de reporte ausente/no reconocida; no se interpreta como consumo.");
        if (textos.km.trim() && f.kilometraje == null) f.motivos.push("Kilometraje conservado como texto");
        if (!textos.piloto.trim() || normalizarIdentificador(textos.piloto) === "NO TIENE NOMBRE") f.motivos.push("Piloto sin determinar");
        if (raw.some(c => c.tipo === ExcelJS.ValueType.Formula || c.tipo === ExcelJS.ValueType.Error)) { f.estado = "INVALIDA"; f.motivos.push("Fórmula/error en fila operativa: no se evalúa."); }
        if (f.estado !== "INVALIDA") {
          f.claveOperacion = hashImportacion(JSON.stringify([f.valeNormalizado]));
          f.fingerprint = hashImportacion(JSON.stringify([f.valeNormalizado, f.placaNormalizada, f.fechaReporte ?? textos.fecha, f.galones ?? textos.galones, f.precio ?? textos.precio, f.total ?? textos.total, normalizarIdentificador(textos.serie), normalizarIdentificador(textos.factura), f.kilometraje ?? normalizarIdentificador(textos.km), normalizarIdentificador(textos.piloto)]));
          if (f.motivos.length) f.estado = "ADVERTENCIA";
        }
      }
      filas.push(f);
    }
  }
  if (!reconocidas) throw new ErrorArchivoProveedor("No se reconocen columnas mínimas: vale, placa y total o galones.");
  const exactas = new Map<string, number>(), operaciones = new Map<string, number[]>();
  filas.forEach((f, idx) => {
    if (!f.fingerprint || !f.claveOperacion) return;
    const anterior = exactas.get(f.fingerprint);
    if (anterior != null) { f.duplicado = "EXACTO"; f.canonica = anterior; }
    else exactas.set(f.fingerprint, idx);
    const grupo = operaciones.get(f.claveOperacion) ?? []; grupo.push(idx); operaciones.set(f.claveOperacion, grupo);
  });
  for (const grupo of operaciones.values()) if (new Set(grupo.map(i => filas[i].fingerprint)).size > 1) for (const i of grupo) if (!filas[i].duplicado) filas[i].duplicado = "POSIBLE";
  return { filas, resumen: resumirImportacion(filas) };
}

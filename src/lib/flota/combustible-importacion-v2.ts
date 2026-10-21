import ExcelJS from "exceljs";
import Decimal from "decimal.js";
import { normalizarFechaExcel } from "./combustible-conciliacion";
import { normalizarIdentificador, normalizarPlacaImportada } from "./combustible-identificadores";
import { ErrorArchivoProveedor, hashImportacion, validarArchivoImportacion, validarContenedorXlsx } from "./combustible-importacion-parser";
import type { CampoProveedor, FilaProveedorV2, PerfilProveedor, PreviewProveedorV2 } from "./combustible-importacion-v2-types";
import { leerOoxmlProveedor } from "./combustible-ooxml-v2";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const alias: Record<CampoProveedor, string[]> = {
  fecha: ["FECHA", "FECHAFACTURA", "FECHACONSUMO"], vale: ["VALE", "NOVALE", "NODEVALE", "NUMEROVALE"],
  placa: ["PLACA", "PLACAS", "NODEPLACAS"], piloto: ["PILOTO", "NOMBREDELPILOTO"],
  galones: ["GALONES", "GLS"], precio: ["PRECIO", "PRECIOGALON"], monto: ["MONTO", "COSTOTOTAL", "TOTAL"],
  serie: ["SERIE", "NOSERIE", "NODESERIE"], factura: ["FACTURA", "NOFACTURA", "NODEFACTURA", "NRODEFACTURA"],
  km: ["KM", "KILOMETRAJE"], producto: ["PRODUCTO", "COMBUSTIBLE"], lote: ["LOTE", "NOLOTE"], auxiliar: ["SALDO", "OBS"],
};
const campos = Object.keys(alias) as CampoProveedor[];
type Columnas = Partial<Record<CampoProveedor, number>>;
function texto(c: ExcelJS.Cell): string {
  const v = c.value;
  if (v == null) return "";
  if (typeof v === "number") return /^0+$/.test(c.numFmt) ? String(v).padStart(c.numFmt.length, "0") : String(v);
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "Fecha inválida" : v.toISOString();
  return c.text;
}
function encabezado(r: ExcelJS.Row): Columnas | null {
  const m: Columnas = {}; let ambiguo = false;
  r.eachCell((c, n) => { for (const k of campos) if (alias[k].includes(norm(texto(c)))) { if (m[k]) ambiguo = true; m[k] = n; } });
  if (ambiguo && m.vale && m.placa) throw new ErrorArchivoProveedor("Encabezados ambiguos: hay columnas repetidas.");
  return !ambiguo && m.vale && m.placa && m.fecha && m.monto && m.galones && m.precio ? m : null;
}

/** Solo corrige residuos IEEE de celdas numéricas, nunca redondea texto de precisión excesiva. */
export function decimalCeldaProveedor(v: unknown, escala = 6): string | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  const s = String(v).trim().replace(/^Q\s*/i, "");
  if (!/^\d+(?:\.\d+)?$/.test(s) && !/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return null;
  const d = new Decimal(s.replace(/,/g, ""));
  if (!d.isFinite() || d.lt(0) || d.gt("999999999999.999999")) return null;
  if (d.decimalPlaces() <= escala) return d.toFixed();
  const redondeado = d.toDecimalPlaces(escala);
  if (typeof v === "number" && d.sub(redondeado).abs().lte(Decimal.max(1, d).mul("0.000000000000001"))) return redondeado.toFixed();
  return null;
}

/** Permite únicamente suma de literales positivos o cociente monto/precio de la misma fila.
 * No usa eval, no sigue vínculos, no ejecuta funciones de Excel. Fórmulas compartidas se traducen por ExcelJS.
 * El cache es evidencia: si falta o difiere del cálculo permitido se bloquea la fila.
 */
function valorSeguro(c: ExcelJS.Cell, perfil: PerfilProveedor, campo: CampoProveedor, columnas: Columnas): { valor: unknown; calculado?: boolean; error?: string } {
  if (c.type === ExcelJS.ValueType.Error) return { valor: null, error: "Error de Excel" };
  if (c.type !== ExcelJS.ValueType.Formula) return { valor: c.value };
  if (perfil !== "SHELL") return { valor: null, error: "Fórmula no permitida para este perfil" };
  let formula: string;
  try { formula = c.formula.replace(/^\+/, "").replace(/\s/g, "").toUpperCase(); } catch { return { valor: null, error: "Fórmula compartida no verificable" }; }
  let calculo: Decimal | null = null;
  if (campo === "monto" && /^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?){1,19}$/.test(formula)) {
    calculo = formula.split("+").reduce((a, s) => a.plus(s), new Decimal(0));
  }
  if (campo === "galones" && columnas.monto && columnas.precio) {
    const ws = c.worksheet;
    const monto = ws.getCell(c.row, columnas.monto), precio = ws.getCell(c.row, columnas.precio);
    if (formula.replace(/\$/g, "") === `${monto.address}/${precio.address}`) {
      const a = valorSeguro(monto, perfil, "monto", columnas), b = valorSeguro(precio, perfil, "precio", columnas);
      const av = decimalCeldaProveedor(a.valor), bv = decimalCeldaProveedor(b.valor);
      if (!a.error && !b.error && av && bv && new Decimal(bv).gt(0)) calculo = new Decimal(av).div(bv);
    }
  }
  const cache = c.result;
  if (!calculo || typeof cache !== "number" || !Number.isFinite(cache) || calculo.sub(cache).abs().gt(Decimal.max(1, calculo.abs()).mul("0.000000000001"))) {
    return { valor: null, error: "Fórmula/resultado almacenado no verificable" };
  }
  // Un cociente permitido puede ser periódico; escala explícita de seis decimales, no inferida del formato visual.
  return { valor: calculo.toDecimalPlaces(6).toFixed(), calculado: true };
}

export function resumirProveedorV2(p: PreviewProveedorV2): void {
  const ops = p.filas.filter(f => f.identidadCandidata);
  const elegibles = ops.filter(f => f.estado !== "INVALIDA" && !f.conflicto && f.duplicadoDe == null && !f.posiblePrevio);
  p.resumen = {
    apariciones: ops.length, candidatos: new Set(ops.map(f => f.identidadCandidata)).size,
    duplicados: ops.filter(f => f.duplicadoDe != null).length,
    conflictos: new Set(ops.filter(f => f.conflicto).map(f => f.identidadCandidata)).size,
    invalidas: p.filas.filter(f => f.estado === "INVALIDA").length,
    ignoradas: p.filas.filter(f => f.estado === "IGNORADA").length,
    posiblesPrevios: new Set(ops.filter(f => f.posiblePrevio).map(f => f.identidadCandidata)).size,
    bloqueados: new Set(ops.filter(f => f.estado === "INVALIDA" || f.conflicto || f.posiblePrevio).map(f => f.identidadCandidata)).size,
    elegibles: elegibles.length,
    galonesElegibles: elegibles.reduce((a, f) => a.plus(f.galones ?? 0), new Decimal(0)).toFixed(),
    montoElegible: elegibles.reduce((a, f) => a.plus(f.monto ?? 0), new Decimal(0)).toFixed(),
  };
}

export async function analizarProveedorV2(buffer: Buffer, perfil: PerfilProveedor): Promise<PreviewProveedorV2> {
  validarArchivoImportacion({ name: "reporte.xlsx", size: buffer.length }); validarContenedorXlsx(buffer);
  const originales = leerOoxmlProveedor(buffer);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer); } catch { throw new ErrorArchivoProveedor("Excel dañado o incompatible."); }
  if (wb.worksheets.length > 20) throw new ErrorArchivoProveedor("Máximo 20 hojas.", 413);
  const filas: FilaProveedorV2[] = []; let reconocidas = 0, posiciones = 0, rawBytes = 0;
  for (const ws of wb.worksheets) {
    if (ws.rowCount > 5000 || ws.columnCount > 100 || (posiciones += ws.rowCount) > 10000) throw new ErrorArchivoProveedor("Máximo 10,000 filas, 5,000 por hoja y 100 columnas.", 413);
    let cols: Columnas | null = null, inicio = 0;
    for (let n = 1; n <= Math.min(25, ws.rowCount); n++) { const m = encabezado(ws.getRow(n)); if (m) { cols = m; inicio = n; reconocidas++; break; } }
    for (let n = 1; n <= ws.rowCount; n++) {
      const row = ws.getRow(n);
      const identificadores = new Map<string, { literal: string; texto: string; seguro: boolean }>();
      for (const k of ["vale", "serie", "factura"] as const) {
        if (!cols?.[k]) continue;
        const c = row.getCell(cols[k]!); const literal = originales.get(ws.name)?.get(c.address);
        if (literal == null || c.type === ExcelJS.ValueType.Formula) continue;
        let seguro = false, convertido = literal;
        try {
          // Nunca convierte identificadores a Number. La notación original queda en evidencia incluso si ExcelJS la redondearía.
          const d = new Decimal(literal);
          seguro = d.isFinite() && d.isInteger() && d.gte(0) && d.lte("9007199254740991");
          if (seguro) convertido = /^0+$/.test(c.numFmt) ? d.toFixed().padStart(c.numFmt.length, "0") : d.toFixed();
        } catch { /* literal numérico inválido: requiere revisión */ }
        identificadores.set(c.address, { literal, texto: convertido, seguro });
      }
      const textos = Object.fromEntries(campos.map(k => {
        const c = cols?.[k] ? row.getCell(cols[k]!) : null;
        return [k, c ? identificadores.get(c.address)?.texto ?? texto(c) : ""];
      })) as Record<CampoProveedor, string>;
      const celdas: FilaProveedorV2["celdas"] = [];
      row.eachCell(c => { if (c.value != null) celdas.push({ direccion: c.address, tipo: c.type, formato: c.numFmt, valor: identificadores.get(c.address)?.literal ?? c.value }); });
      const bytes = Buffer.byteLength(JSON.stringify(celdas)); rawBytes += bytes;
      if (bytes > 100000 || rawBytes > 8 * 1024 * 1024) throw new ErrorArchivoProveedor("Demasiado contenido de celdas.", 413);
      const f: FilaProveedorV2 = {
        hoja: ws.name, fila: n, textos, celdas, fechaConsumo: null, placaOriginal: textos.placa,
        placaNormalizada: normalizarPlacaImportada(textos.placa), vale: normalizarIdentificador(textos.vale),
        serie: textos.serie.trim(), factura: textos.factura.trim(), pilotoInformado: textos.piloto.trim() || null,
        producto: textos.producto.trim() || null, lote: textos.lote.trim() || null,
        galones: null, precio: null, monto: null, kilometraje: null, galonesCalculados: false,
        estado: "VALIDA", motivos: [], identidadCandidata: null, huella: null, duplicadoDe: null, conflicto: false, posiblePrevio: false,
      };
      filas.push(f);
      const tieneVale = !!textos.vale.trim(), tienePlaca = !!textos.placa.trim();
      // Una nota con un nombre en PILOTO no es una operación. Un vale o placa aislados requieren además contexto operativo.
      const contexto = !!(textos.monto.trim() || textos.galones.trim() || (tieneVale && textos.fecha.trim()));
      if (!cols || n <= inicio || encabezado(row) || (!tieneVale && !tienePlaca) || !contexto || /^(TOTAL|SUBTOTAL)\b/i.test(`${textos.vale.trim()} ${textos.placa.trim()}`)) {
        f.estado = "IGNORADA"; f.motivos.push("Cabecera, subtotal, nota o fila sin operación"); continue;
      }
      if (f.vale) f.identidadCandidata = hashImportacion(JSON.stringify([f.vale])); // namespace empresa/proveedor lo aplica el servidor
      const invalidar = (msg: string) => { f.estado = "INVALIDA"; f.motivos.push(msg); };
      if (!f.vale || !f.placaNormalizada) invalidar("Vale y placa son obligatorios");
      const fecha = row.getCell(cols.fecha!);
      if (fecha.type === ExcelJS.ValueType.Formula || fecha.type === ExcelJS.ValueType.Error) invalidar("Fecha no verificable");
      else {
        let v = fecha.value;
        if (typeof v === "number" && wb.properties.date1904) v += 1462;
        f.fechaConsumo = normalizarFechaExcel(v);
        if (!f.fechaConsumo) invalidar("Fecha de consumo inválida o ausente");
      }
      for (const k of ["galones", "precio", "monto"] as const) {
        const c = row.getCell(cols[k]!); const r = valorSeguro(c, perfil, k, cols);
        f[k] = decimalCeldaProveedor(r.valor);
        if (r.error || !f[k] || !new Decimal(f[k]!).gt(0)) invalidar(`${k}: ${r.error ?? "valor positivo/precisión no válido"}`);
        if (k === "galones") f.galonesCalculados = !!r.calculado;
      }
      // Fórmulas fuera de las dos columnas permitidas tampoco son identificadores confiables.
      for (const k of campos.filter(k => !["fecha", "galones", "precio", "monto", "auxiliar"].includes(k))) {
        if (!cols[k]) continue;
        const c = row.getCell(cols[k]!);
        if (c.type === ExcelJS.ValueType.Formula || c.type === ExcelJS.ValueType.Error) invalidar(`${k}: fórmula/error no permitido`);
        if (identificadores.get(c.address)?.seguro === false) invalidar(`${k}: identificador numérico no seguro; literal XML conservado, exige revisión`);
      }
      if (cols.km) f.kilometraje = decimalCeldaProveedor(row.getCell(cols.km).value, 3);
      if (textos.km && f.kilometraje == null) f.motivos.push("Kilometraje conservado como texto");
      if (!f.pilotoInformado || normalizarIdentificador(f.pilotoInformado) === "NO TIENE NOMBRE") { f.pilotoInformado = null; f.motivos.push("Piloto sin determinar"); }
      if (!f.serie || !f.factura) f.motivos.push("Serie/factura incompleta");
      if (!f.producto) f.motivos.push("Producto no informado");
      if (f.galones && f.precio && f.monto && new Decimal(f.galones).mul(f.precio).sub(f.monto).abs().gt("0.01")) f.motivos.push("Galones × precio difiere del monto; revisar redondeo o precio");
      const mesHoja = norm(ws.name).match(/ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|OCTUBRE|OCUTUBRE|NOVIEMBRE|DICIEMBRE/)?.[0];
      const meses = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
      if (mesHoja && f.fechaConsumo && meses.indexOf(mesHoja === "OCUTUBRE" ? "OCTUBRE" : mesHoja) + 1 !== Number(f.fechaConsumo.slice(5, 7))) f.motivos.push("Fecha fuera del mes de la hoja; no se corrige");
      f.huella = hashImportacion(JSON.stringify([f.fechaConsumo, f.placaNormalizada, f.galones, f.precio, f.monto,
        normalizarIdentificador(f.serie), normalizarIdentificador(f.factura), f.producto && normalizarIdentificador(f.producto), f.kilometraje, f.pilotoInformado && normalizarIdentificador(f.pilotoInformado)]));
      if (f.estado !== "INVALIDA" && f.motivos.length) f.estado = "ADVERTENCIA";
    }
  }
  if (!reconocidas) throw new ErrorArchivoProveedor("No se reconocen encabezados de fecha, vale, placa, galones, precio y monto.");
  const grupos = new Map<string, number[]>();
  filas.forEach((f, i) => { if (f.identidadCandidata) { const grupo = grupos.get(f.identidadCandidata) ?? []; grupo.push(i); grupos.set(f.identidadCandidata, grupo); } });
  for (const grupo of grupos.values()) {
    const conflicto = grupo.length > 1 && (new Set(grupo.map(i => filas[i].huella)).size > 1 || grupo.some(i => filas[i].estado === "INVALIDA"));
    const vistas = new Map<string, number>();
    for (const i of grupo) {
      const f = filas[i]; f.conflicto = conflicto;
      if (conflicto) f.motivos.push("Identidad candidata con datos contradictorios o no verificables: bloqueada para revisión");
      if (f.huella && vistas.has(f.huella)) f.duplicadoDe = vistas.get(f.huella)!;
      else if (f.huella) vistas.set(f.huella, i);
    }
  }
  const resultado: PreviewProveedorV2 = { versionContrato: 2, versionParser: 1, perfil, filas, resumen: {} as PreviewProveedorV2["resumen"], coberturaPrevios: "Sin búsqueda de historial" };
  resumirProveedorV2(resultado);
  return resultado;
}

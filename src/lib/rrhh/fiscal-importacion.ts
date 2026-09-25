import ExcelJS from "exceljs";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { hoyLocal } from "./dates";
import { ErrorModeloFiscal, validarAntecedenteFiscal } from "./fiscal-modelo";
import { construirCuerpoMigracion, montoATexto } from "./fiscal-migracion-ui";
import {
  COLUMNAS_ACUMULADOS, HOJA_ACUMULADOS, MAX_BYTES_ACUMULADOS, MAX_FILAS_ACUMULADOS, resumenAnalisis,
  type FilaAnalisis, type ResultadoAnalisis,
} from "./fiscal-importacion-ui";

/**
 * IMPORTACIÓN MASIVA DE ACUMULADOS FISCALES INICIALES (Excel) — plantilla, lectura segura y ANÁLISIS (dry-run, no escribe).
 * La persistencia (todo o nada) vive en fiscal-antecedentes.ts (importarAcumuladosFiscales) y REUTILIZA el mismo núcleo de captura
 * que la ficha individual. Las reglas de fila se reutilizan tal cual: construirCuerpoMigracion (UI del PR #360) y
 * validarAntecedenteFiscal (modelo fiscal) — no hay una versión paralela.
 */
export class ErrorArchivoAcumulados extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

// ------------------------------------------------------------------------------------------------ texto seguro
/** Protección contra inyección de fórmulas al EXPORTAR texto de la BD: `=`, `+`, `-`, `@` (y tab/CR) al inicio se prefijan con `'`. */
export function protegerTextoExcel(valor: string | null | undefined): string {
  const v = String(valor ?? "");
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
/** Inverso al IMPORTAR: quita el `'` de protección solo si lo que sigue empieza con un carácter peligroso. */
export function desprotegerTextoExcel(valor: string): string {
  return /^'[=+\-@\t\r]/.test(valor) ? valor.slice(1) : valor;
}

// ------------------------------------------------------------------------------------------------ plantilla
export type EmpleadoPlantilla = { codigo: string; dpi: string | null; nombre: string };

/** Plantilla .xlsx PRELLENADA (código, DPI, nombre y ejercicio); fecha, importes, referencia y observaciones quedan vacíos. No escribe en BD. */
export async function generarPlantillaAcumulados(empleados: EmpleadoPlantilla[], ejercicio: number): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SITSA Plataforma";
  const ws = wb.addWorksheet(HOJA_ACUMULADOS);
  ws.addRow([...COLUMNAS_ACUMULADOS]);
  ws.getRow(1).font = { bold: true };
  ws.columns = [{ width: 16 }, { width: 18 }, { width: 34 }, { width: 10 }, { width: 16 }, { width: 22 }, { width: 22 }, { width: 20 }, { width: 22 }, { width: 34 }, { width: 34 }];
  for (const e of empleados) {
    const fila = ws.addRow([protegerTextoExcel(e.codigo), protegerTextoExcel(e.dpi ?? ""), protegerTextoExcel(e.nombre), ejercicio, null, null, null, null, null, null, null]);
    fila.getCell(1).numFmt = "@"; fila.getCell(2).numFmt = "@";
  }
  ws.getColumn(5).numFmt = "dd/mm/yyyy";
  for (const c of [6, 7, 8, 9]) ws.getColumn(c).numFmt = "0.00";
  ws.views = [{ state: "frozen", ySplit: 1 }];
  const info = wb.addWorksheet("Instrucciones");
  for (const l of [
    "Acumulados fiscales iniciales (migración desde el sistema anterior)",
    "Usa los acumulados del sistema anterior hasta el último día incluido en el corte. No incluyas planillas que ya fueron procesadas en este sistema.",
    "Identifica al empleado por Código (o DPI si el código va vacío). El nombre es solo informativo; nunca se busca por nombre.",
    "Fecha de corte: último día cubierto por el sistema anterior (dd/mm/aaaa o aaaa-mm-dd). No puede ser futura ni estar fuera del ejercicio.",
    "Importes: números ≥ 0 con máximo 2 decimales, sin fórmulas (0 es válido). Referencia / origen es obligatoria.",
    "Las filas de empleados sin ningún dato en las columnas E a K se ignoran. Una fila con algún dato debe estar completa.",
    "La importación crea BORRADORES; cada acumulado debe confirmarse después, uno por uno, desde la ficha del empleado.",
  ]) info.addRow([l]);
  info.getColumn(1).width = 140;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------------------------------------ lectura del archivo
export type CeldaLeida =
  | { tipo: "vacio" }
  | { tipo: "texto"; valor: string }
  | { tipo: "numero"; valor: number }
  | { tipo: "fecha"; valor: string }
  | { tipo: "formula" }
  | { tipo: "error" };
export type FilaCruda = { numeroFila: number; celdas: CeldaLeida[] };

function celda(v: ExcelJS.CellValue | undefined): CeldaLeida {
  if (v == null) return { tipo: "vacio" };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { tipo: "error" } : { tipo: "fecha", valor: v.toISOString().slice(0, 10) };
  if (typeof v === "number") return Number.isFinite(v) ? { tipo: "numero", valor: v } : { tipo: "error" };
  if (typeof v === "boolean") return { tipo: "texto", valor: String(v) };
  if (typeof v === "string") { const t = v.trim(); return t === "" ? { tipo: "vacio" } : { tipo: "texto", valor: t }; }
  if (typeof v === "object") {
    // NUNCA se evalúan fórmulas: cualquier celda con fórmula se marca y la fila se rechaza con un mensaje claro.
    if ("formula" in v || "sharedFormula" in v) return { tipo: "formula" };
    if ("error" in v) return { tipo: "error" };
    if ("richText" in v) { const t = v.richText.map((x) => x.text).join("").trim(); return t === "" ? { tipo: "vacio" } : { tipo: "texto", valor: t }; }
    if ("text" in v) { const t = String((v as { text: unknown }).text ?? "").trim(); return t === "" ? { tipo: "vacio" } : { tipo: "texto", valor: t }; }
  }
  return { tipo: "error" };
}

const normalizarEncabezado = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Lee la hoja "Acumulados" (sin evaluar fórmulas). Rechaza archivo grande, no .xlsx/corrupto, sin la hoja esperada, encabezados distintos o >2,000 filas. */
export async function leerArchivoAcumulados(buffer: Buffer): Promise<{ filas: FilaCruda[]; omitidasSinDatos: number }> {
  if (buffer.length > MAX_BYTES_ACUMULADOS) throw new ErrorArchivoAcumulados("El archivo excede el tamaño máximo de 5 MB.", 413);
  // .xlsx es un ZIP: firma "PK". Rechaza CSV/otros formatos antes de intentar cargarlos.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ErrorArchivoAcumulados("El archivo no es un libro .xlsx válido.");
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer); }
  catch { throw new ErrorArchivoAcumulados("El archivo está dañado o no es un .xlsx válido."); }
  const ws = wb.getWorksheet(HOJA_ACUMULADOS);
  if (!ws) throw new ErrorArchivoAcumulados(`El libro no tiene la hoja "${HOJA_ACUMULADOS}". Descarga la plantilla y úsala.`);
  const encabezados = COLUMNAS_ACUMULADOS.map((_, i) => {
    const c = celda(ws.getRow(1).getCell(i + 1).value);
    return normalizarEncabezado(c.tipo === "texto" ? c.valor : "");
  });
  COLUMNAS_ACUMULADOS.forEach((esperado, i) => {
    if (encabezados[i] !== normalizarEncabezado(esperado)) {
      throw new ErrorArchivoAcumulados(`La columna ${String.fromCharCode(65 + i)} debe llamarse "${esperado}". Descarga la plantilla actual.`);
    }
  });
  const filas: FilaCruda[] = [];
  let omitidasSinDatos = 0;
  for (let n = 2; n <= ws.rowCount; n++) {
    const row = ws.getRow(n);
    const celdas = COLUMNAS_ACUMULADOS.map((_, i) => celda(row.getCell(i + 1).value));
    if (celdas.every((c) => c.tipo === "vacio")) continue; // fila completamente vacía
    if (celdas.slice(4).every((c) => c.tipo === "vacio")) { omitidasSinDatos += 1; continue; } // plantilla prellenada sin datos fiscales
    filas.push({ numeroFila: n, celdas });
    if (filas.length > MAX_FILAS_ACUMULADOS) throw new ErrorArchivoAcumulados(`El archivo supera el máximo de ${MAX_FILAS_ACUMULADOS} filas de datos.`, 413);
  }
  if (!filas.length) throw new ErrorArchivoAcumulados("El archivo no tiene filas con datos fiscales (columnas E a K).");
  return { filas, omitidasSinDatos };
}

// ------------------------------------------------------------------------------------------------ análisis por fila
type EmpleadoBd = { id: number; codigo: string; dpi: string; nombre: string; estado: string };
const soloDpi = (s: string) => s.replace(/[\s-]/g, "");

const textoCelda = (c: CeldaLeida): string =>
  c.tipo === "texto" ? desprotegerTextoExcel(c.valor) : c.tipo === "numero" ? (Number.isInteger(c.valor) ? String(c.valor) : String(c.valor)) : c.tipo === "fecha" ? c.valor : "";

/** Fecha: Excel date real, dd/mm/aaaa o aaaa-mm-dd → YYYY-MM-DD (o null + mensaje). Nunca inventa una fecha. */
export function normalizarFecha(c: CeldaLeida): { fecha: string | null; error?: string } {
  if (c.tipo === "vacio") return { fecha: null, error: "La fecha de corte es obligatoria." };
  if (c.tipo === "formula" || c.tipo === "error") return { fecha: null, error: "La fecha de corte no puede ser una fórmula ni un error; escribe el valor." };
  let iso: string | null = null;
  if (c.tipo === "fecha") iso = c.valor;
  else if (c.tipo === "texto") {
    const m1 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(c.valor);
    const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(c.valor);
    if (m1) iso = `${m1[3]}-${m1[2].padStart(2, "0")}-${m1[1].padStart(2, "0")}`;
    else if (m2) iso = c.valor;
  }
  if (!iso) return { fecha: null, error: "La fecha de corte no tiene un formato válido (usa dd/mm/aaaa o aaaa-mm-dd)." };
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return { fecha: null, error: "La fecha de corte no es una fecha real." };
  return { fecha: iso };
}

/** Importe: 45000 / 45000.5 / 45000.50 → "45000.00"/"45000.50". Rechaza negativos, texto, NaN, notación científica, fórmulas y más de 2 decimales. */
export function normalizarMonto(c: CeldaLeida, nombre: string): { monto: string | null; error?: string } {
  if (c.tipo === "vacio") return { monto: null, error: `${nombre}: es obligatorio (usa 0 si no hubo).` };
  if (c.tipo === "formula" || c.tipo === "error") return { monto: null, error: `${nombre}: no puede ser una fórmula ni un error; escribe el valor numérico.` };
  if (c.tipo === "fecha") return { monto: null, error: `${nombre}: debe ser un número.` };
  let texto: string;
  if (c.tipo === "numero") {
    if (c.valor < 0) return { monto: null, error: `${nombre}: no puede ser negativo.` };
    if (Math.abs(c.valor * 100 - Math.round(c.valor * 100)) > 1e-6) return { monto: null, error: `${nombre}: admite máximo 2 decimales.` };
    texto = c.valor.toFixed(2);
  } else texto = desprotegerTextoExcel(c.valor);
  const m = montoATexto(texto); // misma regla que la ficha: ≥ 0, máx. 2 decimales, sin notación científica, rango DECIMAL
  return m == null ? { monto: null, error: `${nombre}: indica un monto ≥ 0 con máximo 2 decimales, sin fórmulas ni notación científica.` } : { monto: m };
}

export type DatosAnalisis = {
  empleados: EmpleadoBd[];
  /** clave `${empleadoId}:${ejercicio}` → { confirmada, existe } */
  revisiones: Map<string, { existe: boolean; confirmada: boolean }>;
  /** empleadoId → períodos AUTORIZADOS del sistema con líneas del empleado */
  periodos: Map<number, { fechaInicio: string; fechaFin: string; codigo: string }[]>;
};

/** Análisis PURO de las filas contra los datos ya leídos de la BD (sin escribir). Todo el tenant sale de `datos` (una sola empresa). */
export function analizarFilas(filas: FilaCruda[], datos: DatosAnalisis, omitidasSinDatos = 0, hoy: string = hoyLocal()): ResultadoAnalisis {
  const porCodigo = new Map(datos.empleados.map((e) => [e.codigo, e]));
  const porDpi = new Map<string, EmpleadoBd[]>();
  for (const e of datos.empleados) if (e.dpi) porDpi.set(soloDpi(e.dpi), [...(porDpi.get(soloDpi(e.dpi)) ?? []), e]);

  const salida: FilaAnalisis[] = filas.map((f) => {
    const [cCod, cDpi, cNom, cEj, cFecha, cGrav, cExe, cIgss, cIsr, cRef, cObs] = f.celdas;
    const mensajes: string[] = [];
    const avisos: string[] = [];
    const codigo = textoCelda(cCod).trim();
    const dpi = textoCelda(cDpi).trim();
    const nombre = textoCelda(cNom).trim();
    const referencia = textoCelda(cRef).trim();
    for (const c of f.celdas) if (c.tipo === "formula") { mensajes.push("Hay celdas con fórmula: escribe los valores directamente (las fórmulas no se evalúan)."); break; }

    // ---- empleado (código exacto → DPI; nunca por nombre)
    let empleado: EmpleadoBd | null = null;
    const porC = codigo ? porCodigo.get(codigo) ?? null : null;
    const dpiCoincidencias = dpi ? porDpi.get(soloDpi(dpi)) ?? [] : [];
    if (!codigo && !dpi) mensajes.push("Indica el código del empleado o su DPI.");
    else if (codigo && !porC) mensajes.push(`El código "${codigo}" no corresponde a ningún empleado de esta empresa.`);
    else if (dpiCoincidencias.length > 1) mensajes.push("El DPI corresponde a más de un empleado: usa el código.");
    else if (porC && dpiCoincidencias.length === 1 && dpiCoincidencias[0].id !== porC.id) mensajes.push("El código y el DPI corresponden a empleados distintos.");
    else if (porC) {
      empleado = porC;
      if (dpi && !dpiCoincidencias.length) avisos.push("El DPI del archivo no coincide con el registrado; se usó el código.");
    } else if (!codigo && dpi) {
      if (!dpiCoincidencias.length) mensajes.push("El DPI no corresponde a ningún empleado de esta empresa.");
      else empleado = dpiCoincidencias[0];
    }
    if (empleado && nombre && normalizarEncabezado(nombre) !== normalizarEncabezado(empleado.nombre)) avisos.push("El nombre del archivo difiere del registrado (solo informativo).");

    // ---- ejercicio
    let ejercicio: number | null = null;
    if (cEj.tipo === "numero" && Number.isInteger(cEj.valor)) ejercicio = cEj.valor;
    else if (cEj.tipo === "texto" && /^\d{4}$/.test(cEj.valor)) ejercicio = Number(cEj.valor);
    if (ejercicio == null || ejercicio < 2000 || ejercicio > 9999) { mensajes.push("El ejercicio debe ser un año de 4 dígitos."); ejercicio = null; }

    // ---- fecha e importes
    const fecha = normalizarFecha(cFecha);
    if (fecha.error) mensajes.push(fecha.error);
    const g = normalizarMonto(cGrav, "Ingresos gravados acumulados");
    const x = normalizarMonto(cExe, "Ingresos exentos acumulados");
    const i = normalizarMonto(cIgss, "IGSS laboral acumulado");
    const r = normalizarMonto(cIsr, "ISR retenido acumulado");
    for (const m of [g, x, i, r]) if (m.error) mensajes.push(m.error);
    if (!referencia) mensajes.push("Indica el origen / referencia (por ejemplo, el reporte del sistema anterior).");

    // ---- reglas del modelo fiscal REUTILIZADAS (mismas que la ficha #360 y el servidor)
    if (!mensajes.length && ejercicio != null && fecha.fecha) {
      const cuerpo = construirCuerpoMigracion(
        { fechaCorte: fecha.fecha, gravado: g.monto!, exento: x.monto!, igss: i.monto!, isr: r.monto!, referencia, observaciones: textoCelda(cObs).trim() },
        ejercicio, 0, hoy);
      if ("error" in cuerpo) mensajes.push(cuerpo.error);
      else {
        try { validarAntecedenteFiscal(cuerpo.cuerpo.antecedente, ejercicio, false, hoy); }
        catch (e) { mensajes.push(e instanceof ErrorModeloFiscal ? e.message : "Datos fiscales inválidos."); }
      }
    }

    // ---- revisión existente y anti doble conteo
    if (empleado && ejercicio != null) {
      const rev = datos.revisiones.get(`${empleado.id}:${ejercicio}`);
      if (rev?.confirmada) mensajes.push("El empleado ya tiene una revisión fiscal confirmada para este ejercicio.");
      else if (rev?.existe) mensajes.push("Ya existe un borrador fiscal. Debes resolverlo antes de importar.");
      if (fecha.fecha) {
        const solapa = (datos.periodos.get(empleado.id) ?? []).find((p) => p.fechaInicio <= fecha.fecha! && p.fechaFin >= `${ejercicio}-01-01`);
        if (solapa) mensajes.push(`El acumulado fiscal inicial se solapa con una planilla autorizada del sistema (${solapa.codigo}). Revisa la fecha de corte para evitar doble conteo.`);
      }
    }
    return {
      numeroFila: f.numeroFila, empleadoId: empleado?.id ?? null, codigo: empleado?.codigo ?? codigo, dpi: empleado?.dpi ?? dpi, nombre: empleado?.nombre ?? nombre,
      ejercicio, fechaCorte: fecha.fecha, gravado: g.monto, exento: x.monto, igss: i.monto, isr: r.monto, referencia, observaciones: textoCelda(cObs).trim(),
      estado: mensajes.length ? "ERROR" : avisos.length ? "ADVERTENCIA" : "VALIDA", mensajes: [...mensajes, ...avisos],
    } satisfies FilaAnalisis;
  });

  // ---- duplicados: el MISMO empleado (aunque una fila venga por código y otra por DPI) → error en todo el grupo
  const grupos = new Map<number, FilaAnalisis[]>();
  for (const f of salida) if (f.empleadoId != null) grupos.set(f.empleadoId, [...(grupos.get(f.empleadoId) ?? []), f]);
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    const filasDup = g.map((f) => f.numeroFila).join(", ");
    for (const f of g) { f.estado = "ERROR"; f.mensajes = [`El mismo empleado aparece más de una vez en el archivo (filas ${filasDup}). No se elige una arbitrariamente.`, ...f.mensajes]; }
  }
  return resumenAnalisis(salida, omitidasSinDatos);
}

// ------------------------------------------------------------------------------------------------ lecturas de BD (solo lectura)
/** Empleados de la empresa (todos los estados, para identificar). */
export async function cargarEmpleadosEmpresa(empresaId: number): Promise<EmpleadoBd[]> {
  const rows = await query<RowDataPacket[]>("SELECT id, codigo, nombre, dpi, estado FROM empleados WHERE empresa_id = ?", [empresaId]);
  return rows.map((r) => ({ id: Number(r.id), codigo: String(r.codigo ?? "").trim(), dpi: String(r.dpi ?? "").trim(), nombre: String(r.nombre ?? ""), estado: String(r.estado ?? "") }));
}

/** Activos y Bajas RELEVANTES (sin egreso o con egreso en/después del ejercicio) para prellenar la plantilla. */
export async function cargarEmpleadosPlantilla(empresaId: number, ejercicio: number): Promise<EmpleadoPlantilla[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT codigo, dpi, nombre FROM empleados
     WHERE empresa_id = ? AND (estado = 'Activo' OR (estado = 'Baja' AND (fecha_egreso IS NULL OR YEAR(fecha_egreso) >= ?)))
     ORDER BY nombre`, [empresaId, ejercicio]);
  return rows.map((r) => ({ codigo: String(r.codigo ?? ""), dpi: r.dpi ? String(r.dpi) : null, nombre: String(r.nombre ?? "") }));
}

export async function cargarDatosAnalisis(empresaId: number, empleados: EmpleadoBd[], ejercicios: number[]): Promise<DatosAnalisis> {
  const ids = empleados.map((e) => e.id);
  const revisiones = new Map<string, { existe: boolean; confirmada: boolean }>();
  const periodos = new Map<number, { fechaInicio: string; fechaFin: string; codigo: string }[]>();
  if (!ids.length) return { empleados, revisiones, periodos };
  const ph = ids.map(() => "?").join(",");
  const revs = await query<RowDataPacket[]>(
    `SELECT id_empleado, ejercicio, COUNT(*) AS n, MAX(CASE WHEN confirmado_en IS NOT NULL THEN 1 ELSE 0 END) AS confirmada
     FROM rrhh_fiscal_empleado_ejercicio WHERE empresa_id = ? AND id_empleado IN (${ph}) AND ejercicio IN (${ejercicios.map(() => "?").join(",") || "NULL"})
     GROUP BY id_empleado, ejercicio`, [empresaId, ...ids, ...ejercicios]);
  for (const r of revs) revisiones.set(`${Number(r.id_empleado)}:${Number(r.ejercicio)}`, { existe: Number(r.n) > 0, confirmada: Number(r.confirmada) === 1 });
  const per = await query<RowDataPacket[]>(
    `SELECT DISTINCT l.id_empleado, p.codigo, p.fecha_inicio, p.fecha_fin
     FROM rrhh_planilla_periodos p INNER JOIN rrhh_planilla_lineas l ON l.periodo_id = p.id AND l.empresa_id = p.empresa_id
     WHERE p.empresa_id = ? AND p.autorizado_en IS NOT NULL AND l.id_empleado IN (${ph})`, [empresaId, ...ids]);
  const dia = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
  for (const r of per) periodos.set(Number(r.id_empleado), [...(periodos.get(Number(r.id_empleado)) ?? []), { fechaInicio: dia(r.fecha_inicio), fechaFin: dia(r.fecha_fin), codigo: String(r.codigo) }]);
  return { empleados, revisiones, periodos };
}

/** Análisis completo de un archivo (DRY-RUN: solo lecturas). */
export async function analizarArchivoAcumulados(empresaId: number, buffer: Buffer): Promise<ResultadoAnalisis> {
  const { filas, omitidasSinDatos } = await leerArchivoAcumulados(buffer);
  const empleados = await cargarEmpleadosEmpresa(empresaId);
  const ejercicios = [...new Set(filas.map((f) => { const c = f.celdas[3]; return c.tipo === "numero" ? c.valor : c.tipo === "texto" ? Number(c.valor) : NaN; }).filter((n) => Number.isInteger(n) && n >= 2000 && n <= 9999))];
  const datos = await cargarDatosAnalisis(empresaId, empleados, ejercicios);
  return analizarFilas(filas, datos, omitidasSinDatos);
}

/**
 * Ítems para la importación real, DERIVADOS del análisis del servidor (nunca de filas enviadas por el cliente). Usa el mismo
 * constructor de cuerpo que la ficha (construirCuerpoMigracion). Solo filas sin error.
 */
export function construirItemsImportacion(analisis: ResultadoAnalisis, hoy: string = hoyLocal()) {
  return analisis.filas.filter((f) => f.estado !== "ERROR").map((f) => {
    const c = construirCuerpoMigracion(
      { fechaCorte: f.fechaCorte!, gravado: f.gravado!, exento: f.exento!, igss: f.igss!, isr: f.isr!, referencia: f.referencia, observaciones: f.observaciones },
      f.ejercicio!, 0, hoy);
    if ("error" in c) throw new ErrorModeloFiscal(`Fila ${f.numeroFila}: ${c.error}`);
    return { numeroFila: f.numeroFila, empleadoId: f.empleadoId!, ejercicio: f.ejercicio!, antecedente: c.cuerpo.antecedente };
  });
}

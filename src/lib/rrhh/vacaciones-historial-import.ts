/**
 * RRHH VACACIONES — LECTURA Y NORMALIZACIÓN DEL ARCHIVO HISTÓRICO OFICIAL (módulo PURO: sin BD ni red).
 *
 * Formato esperado (CSV UTF-8 con `,` `;` o tabulación, o la primera hoja de un .xlsx; primera fila = encabezados):
 *
 *   OBLIGATORIAS
 *     - Identificador del empleado: AL MENOS UNA de `codigo` (empleados.codigo), `dpi` o `nombre`
 *       (prioridad por fila: código > DPI > nombre; el nombre debe coincidir exactamente, sin acentos ni mayúsculas, y ser único)
 *     - `fecha_inicio`   (YYYY-MM-DD o DD/MM/YYYY)
 *     - `fecha_fin`      (YYYY-MM-DD o DD/MM/YYYY; >= fecha_inicio)
 *     - `dias_habiles`   (número > 0; admite medio día; coma o punto decimal)
 *   OPCIONALES
 *     - `tipo`           (Vacaciones | A cuenta de Vacaciones; vacío = Vacaciones). Otros tipos NO son reconstruibles.
 *     - `observacion`    (observación / referencia del registro)
 *   Cualquier otra columna se IGNORA y se informa explícitamente (nunca se mapea en silencio).
 *
 * Llave lógica de importación (duplicados): empleado + fecha_inicio + fecha_fin + dias_habiles + tipo.
 */

export const MAX_FILAS_ARCHIVO = 5000;
export const TIPOS_RECONSTRUIBLES = ["Vacaciones", "A cuenta de Vacaciones"] as const;
export type TipoVacacionImport = (typeof TIPOS_RECONSTRUIBLES)[number];

export type CampoArchivo = "codigo" | "dpi" | "nombre" | "fecha_inicio" | "fecha_fin" | "dias_habiles" | "tipo" | "observacion";

/** Alias aceptados por campo (ya normalizados: minúsculas, sin acentos, guion bajo). */
export const ALIAS_COLUMNAS: Record<CampoArchivo, readonly string[]> = {
  codigo: ["codigo", "codigo_empleado", "cod_empleado", "empleado_codigo", "no_empleado", "numero_empleado"],
  dpi: ["dpi", "cui", "empleado_dpi"],
  nombre: ["nombre", "empleado", "colaborador", "nombre_empleado", "empleado_nombre"],
  fecha_inicio: ["fecha_inicio", "inicio", "desde", "fecha_desde", "fecha_inicial"],
  fecha_fin: ["fecha_fin", "fin", "hasta", "fecha_hasta", "fecha_final"],
  dias_habiles: ["dias_habiles", "dias", "dias_tomados", "dias_hab", "cantidad_dias"],
  tipo: ["tipo", "tipo_vacacion", "tipo_registro"],
  observacion: ["observacion", "observaciones", "referencia", "nota", "notas", "comentario"],
};
const OBLIGATORIAS: readonly CampoArchivo[] = ["fecha_inicio", "fecha_fin", "dias_habiles"];
const IDENTIFICADORES: readonly CampoArchivo[] = ["codigo", "dpi", "nombre"];

export const normalizarTexto = (v: unknown): string =>
  String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const normalizarEncabezado = (v: unknown): string => normalizarTexto(v).replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

export type ColumnasDetectadas = {
  /** campo interno → encabezado original del archivo */
  mapeadas: Partial<Record<CampoArchivo, string>>;
  /** encabezados que NO se mapearon a ningún campo (se ignoran) */
  ignoradas: string[];
  /** campos obligatorios que faltan (incluye "identificador" si no hay código, DPI ni nombre) */
  faltantes: string[];
};

export function detectarColumnas(encabezados: readonly string[]): ColumnasDetectadas {
  const mapeadas: Partial<Record<CampoArchivo, string>> = {};
  const ignoradas: string[] = [];
  for (const original of encabezados) {
    const n = normalizarEncabezado(original);
    if (!n) continue;
    const campo = (Object.keys(ALIAS_COLUMNAS) as CampoArchivo[]).find((c) => ALIAS_COLUMNAS[c].includes(n));
    if (campo && !mapeadas[campo]) mapeadas[campo] = original;
    else ignoradas.push(original);
  }
  const faltantes: string[] = OBLIGATORIAS.filter((c) => !mapeadas[c]);
  if (!IDENTIFICADORES.some((c) => mapeadas[c])) faltantes.unshift("identificador (codigo, dpi o nombre)");
  return { mapeadas, ignoradas, faltantes };
}

export type FilaCruda = { fila: number; valores: Record<string, unknown> };

/** Lee un CSV (delimitador `,` `;` o tab, comillas dobles, BOM) y devuelve encabezados y filas con su número de fila del archivo. */
export function parsearCsv(texto: string): { encabezados: string[]; filas: FilaCruda[] } {
  const limpio = texto.replace(/^﻿/, "");
  const primera = limpio.split(/\r?\n/, 1)[0] ?? "";
  const delimitador = [";", "\t", ","].map((d) => ({ d, n: primera.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const registros: string[][] = [];
  let campo = "", registro: string[] = [], enComillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (enComillas) {
      if (c === '"' && limpio[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') enComillas = false;
      else campo += c;
    } else if (c === '"') enComillas = true;
    else if (c === delimitador) { registro.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && limpio[i + 1] === "\n") i++;
      registro.push(campo); campo = "";
      registros.push(registro); registro = [];
    } else campo += c;
  }
  if (campo !== "" || registro.length) { registro.push(campo); registros.push(registro); }
  const [cab, ...datos] = registros;
  const encabezados = (cab ?? []).map((h) => h.trim());
  const filas: FilaCruda[] = [];
  datos.forEach((r, i) => {
    if (r.every((x) => x.trim() === "")) return; // fila vacía
    const valores: Record<string, unknown> = {};
    encabezados.forEach((h, k) => { if (h) valores[h] = (r[k] ?? "").trim(); });
    filas.push({ fila: i + 2, valores });
  });
  return { encabezados, filas };
}

/** Fecha → "YYYY-MM-DD" o null. Acepta ISO, DD/MM/YYYY (D/M/YYYY, con - o .), Date y serial de Excel. NUNCA interpreta MM/DD. */
export function parsearFecha(v: unknown): string | null {
  if (v == null || v === "") return null;
  const valida = (a: number, m: number, d: number): string | null => {
    if (a < 1900 || a > 2100 || m < 1 || m > 12 || d < 1) return null;
    const f = new Date(Date.UTC(a, m - 1, d));
    if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
    return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : valida(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === "number") {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return null; // serial de Excel plausible (1954-2119)
    const f = new Date(Math.round((v - 25569) * 86400000));
    return valida(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return valida(Number(m[3]), Number(m[2]), Number(m[1])); // DD/MM/YYYY
  return null;
}

export function parsearDias(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n > 365) return null;
  return Math.round(n * 100) / 100;
}

export function normalizarTipo(v: unknown): TipoVacacionImport | null {
  const n = normalizarTexto(v);
  if (n === "" || n === "vacaciones" || n === "vacacion") return "Vacaciones";
  if (n === "a cuenta" || n === "a cuenta de vacaciones" || n === "a cuenta vacaciones") return "A cuenta de Vacaciones";
  return null;
}

export type CodigoProblemaFila =
  | "COLUMNAS_FALTANTES"
  | "EXCESO_DE_FILAS"
  | "SIN_IDENTIFICADOR"
  | "FECHA_INICIO_INVALIDA"
  | "FECHA_FIN_INVALIDA"
  | "FECHA_FIN_ANTERIOR_A_INICIO"
  | "DIAS_INVALIDOS"
  | "TIPO_NO_RECONSTRUIBLE";

export type ProblemaFila = { fila: number; codigo: CodigoProblemaFila; mensaje: string };

export type FilaNormalizada = {
  fila: number;
  codigo: string | null;
  dpi: string | null;
  nombre: string | null;
  inicio: string;
  fin: string;
  dias: number;
  tipo: TipoVacacionImport;
  observacion: string | null;
};

const texto = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};

export function normalizarFilas(filas: readonly FilaCruda[], columnas: ColumnasDetectadas): { validas: FilaNormalizada[]; invalidas: ProblemaFila[] } {
  const validas: FilaNormalizada[] = [], invalidas: ProblemaFila[] = [];
  if (columnas.faltantes.length) {
    invalidas.push({ fila: 1, codigo: "COLUMNAS_FALTANTES", mensaje: `Faltan columnas obligatorias: ${columnas.faltantes.join(", ")}.` });
    return { validas, invalidas };
  }
  if (filas.length > MAX_FILAS_ARCHIVO) {
    invalidas.push({ fila: 1, codigo: "EXCESO_DE_FILAS", mensaje: `El archivo tiene ${filas.length} filas; el máximo es ${MAX_FILAS_ARCHIVO}.` });
    return { validas, invalidas };
  }
  const col = columnas.mapeadas;
  const val = (f: FilaCruda, c: CampoArchivo) => (col[c] ? f.valores[col[c]!] : undefined);
  for (const f of filas) {
    const codigo = texto(val(f, "codigo")), dpi = texto(val(f, "dpi")), nombre = texto(val(f, "nombre"));
    if (!codigo && !dpi && !nombre) { invalidas.push({ fila: f.fila, codigo: "SIN_IDENTIFICADOR", mensaje: "La fila no trae código, DPI ni nombre del empleado." }); continue; }
    const inicio = parsearFecha(val(f, "fecha_inicio"));
    if (!inicio) { invalidas.push({ fila: f.fila, codigo: "FECHA_INICIO_INVALIDA", mensaje: `Fecha de inicio inválida: «${String(val(f, "fecha_inicio") ?? "")}» (use YYYY-MM-DD o DD/MM/YYYY).` }); continue; }
    const fin = parsearFecha(val(f, "fecha_fin"));
    if (!fin) { invalidas.push({ fila: f.fila, codigo: "FECHA_FIN_INVALIDA", mensaje: `Fecha de fin inválida: «${String(val(f, "fecha_fin") ?? "")}» (use YYYY-MM-DD o DD/MM/YYYY).` }); continue; }
    if (fin < inicio) { invalidas.push({ fila: f.fila, codigo: "FECHA_FIN_ANTERIOR_A_INICIO", mensaje: `La fecha de fin (${fin}) es anterior a la de inicio (${inicio}).` }); continue; }
    const dias = parsearDias(val(f, "dias_habiles"));
    if (dias == null) { invalidas.push({ fila: f.fila, codigo: "DIAS_INVALIDOS", mensaje: `Días hábiles inválidos: «${String(val(f, "dias_habiles") ?? "")}» (número > 0).` }); continue; }
    const tipo = normalizarTipo(val(f, "tipo"));
    if (!tipo) { invalidas.push({ fila: f.fila, codigo: "TIPO_NO_RECONSTRUIBLE", mensaje: `El tipo «${String(val(f, "tipo"))}» no es reconstruible (solo Vacaciones o A cuenta de Vacaciones).` }); continue; }
    validas.push({ fila: f.fila, codigo, dpi, nombre, inicio, fin, dias, tipo, observacion: texto(val(f, "observacion")) });
  }
  return { validas, invalidas };
}

/** Llave lógica de importación (duplicados). `empleadoClave` = id del empleado ya resuelto (o el identificador normalizado si no se resolvió). */
export function llaveLogica(empleadoClave: string | number, f: { inicio: string; fin: string; dias: number; tipo: string }): string {
  return [empleadoClave, f.inicio, f.fin, f.dias.toFixed(2), f.tipo].join("|");
}

import ExcelJS from "exceljs";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 2 de 6) — plantilla + parser de la
 * importación masiva de Programación. Ver docs/TMS-IMPORTACION-
 * PROGRAMACION-EXCEL-{0,1,2}-*.md para el diseño completo aprobado.
 *
 * Este módulo cubre EXCLUSIVAMENTE:
 *   - generación dinámica de la plantilla (6 hojas: Programacion + 4
 *     catálogos de referencia + Instrucciones);
 *   - lectura/parser de la hoja "Programacion";
 *   - normalización y validaciones SINTÁCTICAS puras (formato de fecha/
 *     hora, campos obligatorios, límite de filas, encabezados).
 *
 * Todavía NO valida contra catálogo/BD (existencia de ruta/cliente/
 * piloto/auxiliar/unidad, tarifa vigente, traslapes, duplicados
 * semánticos) — eso es alcance de los PR 3/4/5. `parsearExcelProgramacion`
 * no hace ninguna consulta a BD; solo `generarPlantillaProgramacion` la
 * usa, y únicamente para poblar las hojas de catálogo de REFERENCIA (que
 * nunca son fuente de verdad al importar — el backend siempre revalida
 * contra BD fresca en una fase posterior).
 *
 * Mismo estilo de helpers (cellStr/normalizarHora/normalizarFecha) que
 * rutas-import-excel.ts y src/lib/rrhh/marcajes-import-excel.ts, sin
 * importarlos de ahí (son privados a esos módulos) y sin tocarlos.
 */

// ---------------------------------------------------------------------
// Columnas de la hoja "Programacion" (13 columnas aprobadas, sin cambios)
// ---------------------------------------------------------------------

export const ENCABEZADOS_PROGRAMACION = [
  "Fecha salida",
  "Hora salida",
  "Código ruta",
  "Cliente",
  "Código piloto",
  "Placa",
  "Código auxiliar 1",
  "Código auxiliar 2",
  "Tipo traslado",
  "Tarifa GTQ",
  "Fecha regreso estimado",
  "Hora regreso estimado",
  "Observaciones",
] as const;

const COL_FECHA_SALIDA = 1; // A
const COL_HORA_SALIDA = 2; // B
const COL_CODIGO_RUTA = 3; // C
const COL_CLIENTE = 4; // D
const COL_PILOTO = 5; // E
const COL_PLACA = 6; // F
const COL_AUX1 = 7; // G
const COL_AUX2 = 8; // H
const COL_TIPO_TRASLADO = 9; // I
const COL_TARIFA = 10; // J
const COL_FECHA_REGRESO = 11; // K
const COL_HORA_REGRESO = 12; // L
const COL_OBSERVACIONES = 13; // M

const HOJA_PROGRAMACION = "Programacion";
const FILA_ENCABEZADO = 1;
const FILA_EJEMPLO_1 = 2; // filas 2-3 = ejemplo (2 filas); los datos reales empiezan en FILA_INICIO_DATOS
const FILA_INICIO_DATOS = 4;
const CODIGO_EJEMPLO = "ejemplo-no-importar";

/** Máximo de filas útiles por archivo — rechazo total si se excede (decisión aprobada). */
export const MAX_FILAS_PROGRAMACION = 500;

export type FilaProgramacionExcel = {
  filaExcel: number;
  /** "YYYY-MM-DD" o null si vino vacío o no se pudo interpretar. */
  fechaSalidaExcel: string | null;
  /** "HH:mm" (24h) o null si vino vacío o no se pudo interpretar. */
  horaSalidaExcel: string | null;
  codigoRutaExcel: string;
  /** Solo de contraste — nunca resuelve el cliente (eso lo determina la ruta). */
  clienteExcel: string;
  pilotoCodigoExcel: string;
  placaExcel: string;
  auxiliar1CodigoExcel: string;
  auxiliar2CodigoExcel: string;
  tipoTrasladoExcel: string;
  tarifaExcel: number | null;
  fechaRegresoExcel: string | null;
  horaRegresoExcel: string | null;
  observacionesExcel: string;
  /** Errores puramente sintácticos de ESTA fila (formato/obligatoriedad/regreso vs. salida). Vacío = fila sintácticamente correcta. */
  erroresSintacticos: string[];
};

// ---------------------------------------------------------------------
// Helpers de lectura/normalización (puros, sin BD)
// ---------------------------------------------------------------------

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

/** trim + colapsar espacios internos — para todo campo de texto que se comparará después contra catálogo. */
function normalizarEspacios(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Igual + minúsculas + sin acentos — SOLO para comparar contra literales conocidos (encabezados, marcador de ejemplo). */
function normalizarComparacion(s: string): string {
  return normalizarEspacios(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function normalizarPlaca(value: unknown): string {
  return normalizarEspacios(cellStr(value)).toUpperCase();
}

function excelSerialAFecha(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const dias = Math.floor(serial);
  const fecha = new Date(Date.UTC(1899, 11, 30) + dias * 86400000);
  const y = fecha.getUTCFullYear();
  const m = String(fecha.getUTCMonth() + 1).padStart(2, "0");
  const d = String(fecha.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Acepta Date (serial de Excel ya decodificado), número (serial crudo), "YYYY-MM-DD" o "DD/MM/YYYY"/"DD-MM-YYYY". */
function normalizarFecha(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number") return excelSerialAFecha(value);
  const raw = cellStr(value).trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, mRaw, dRaw] = iso;
    const m = mRaw.padStart(2, "0");
    const d = dRaw.padStart(2, "0");
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return `${y}-${m}-${d}`;
  }
  const latam = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (latam) {
    const [, dRaw, mRaw, y] = latam;
    const d = dRaw.padStart(2, "0");
    const m = mRaw.padStart(2, "0");
    if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
    return `${y}-${m}-${d}`;
  }
  return null;
}

function segundosAHora(segundos: number): string {
  const normalized = ((Math.round(segundos) % 86400) + 86400) % 86400;
  const h = Math.floor(normalized / 3600);
  const m = Math.floor((normalized % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Acepta Date (hora de Excel), número (fracción de día), texto 24h
 * "HH:mm"/"HH:mm:ss", o texto 12h "H:mm AM/PM" (con o sin punto,
 * ej. "a.m."). Medianoche 12:00 AM -> 00:00; mediodía 12:00 PM -> 12:00.
 */
function normalizarHora(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof value === "number") {
    const fraccion = value >= 0 && value < 1 ? value : value - Math.floor(value);
    if (fraccion >= 0 && fraccion < 1) return segundosAHora(fraccion * 86400);
    return null;
  }
  const raw = cellStr(value).trim();
  if (!raw) return null;

  const m24 = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m24) {
    const h = Number(m24[1]);
    const m = Number(m24[2]);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  const m12 = raw.match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/);
  if (m12) {
    let h = Number(m12[1]);
    const m = Number(m12[2]);
    const esPm = m12[3].toLowerCase() === "p";
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (h === 12) h = esPm ? 12 : 0;
    else if (esPm) h += 12;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  return null;
}

function normalizarTarifa(value: unknown): { valor: number | null; error: string | null } {
  const raw = cellStr(value).trim();
  // Tarifa vacía: NO es un error sintáctico en este PR — la comparación
  // "diferencia contra la tarifa vigente = error bloqueante" (decisión ya
  // aprobada) es una validación de CATÁLOGO/BD, fuera de alcance de este
  // parser puro (PR 3/4). Aquí solo se valida el FORMATO si vino algo.
  if (!raw) return { valor: null, error: null };
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0
      ? { valor: value, error: null }
      : { valor: null, error: "Tarifa GTQ: debe ser un número mayor o igual a cero." };
  }
  const limpio = raw.replace(/[Q,$\s]/g, "");
  const parsed = Number(limpio);
  return Number.isFinite(parsed) && parsed >= 0
    ? { valor: parsed, error: null }
    : { valor: null, error: "Tarifa GTQ: debe ser un número mayor o igual a cero." };
}

function letraColumna(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const rem = (x - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// ---------------------------------------------------------------------
// Parser de la hoja "Programacion" (puro, sin BD)
// ---------------------------------------------------------------------

function parsearFila(
  ws: ExcelJS.Worksheet,
  rowIndex: number,
): FilaProgramacionExcel {
  const row = ws.getRow(rowIndex);
  const errores: string[] = [];

  const fechaSalidaRaw = row.getCell(COL_FECHA_SALIDA).value;
  const fechaSalidaTxt = cellStr(fechaSalidaRaw).trim();
  const fechaSalidaExcel = normalizarFecha(fechaSalidaRaw);
  if (!fechaSalidaExcel) {
    errores.push(
      fechaSalidaTxt
        ? `Fecha salida inválida: "${fechaSalidaTxt}".`
        : "Fecha salida es obligatoria.",
    );
  }

  const horaSalidaRaw = row.getCell(COL_HORA_SALIDA).value;
  const horaSalidaTxt = cellStr(horaSalidaRaw).trim();
  const horaSalidaExcel = normalizarHora(horaSalidaRaw);
  if (!horaSalidaExcel && horaSalidaTxt) {
    errores.push(`Hora salida inválida: "${horaSalidaTxt}".`);
  }

  const codigoRutaExcel = normalizarEspacios(cellStr(row.getCell(COL_CODIGO_RUTA).value));
  if (!codigoRutaExcel) errores.push("Código ruta es obligatorio.");

  const clienteExcel = normalizarEspacios(cellStr(row.getCell(COL_CLIENTE).value));

  const pilotoCodigoExcel = normalizarEspacios(cellStr(row.getCell(COL_PILOTO).value));
  if (!pilotoCodigoExcel) errores.push("Código piloto es obligatorio.");

  const placaExcel = normalizarPlaca(row.getCell(COL_PLACA).value);
  if (!placaExcel) errores.push("Placa es obligatoria.");

  const auxiliar1CodigoExcel = normalizarEspacios(cellStr(row.getCell(COL_AUX1).value));
  const auxiliar2CodigoExcel = normalizarEspacios(cellStr(row.getCell(COL_AUX2).value));

  const tipoTrasladoExcel = normalizarEspacios(cellStr(row.getCell(COL_TIPO_TRASLADO).value));

  const tarifa = normalizarTarifa(row.getCell(COL_TARIFA).value);
  if (tarifa.error) errores.push(tarifa.error);

  const fechaRegresoRaw = row.getCell(COL_FECHA_REGRESO).value;
  const fechaRegresoTxt = cellStr(fechaRegresoRaw).trim();
  const fechaRegresoExcel = normalizarFecha(fechaRegresoRaw);
  if (!fechaRegresoExcel && fechaRegresoTxt) {
    errores.push(`Fecha regreso estimado inválida: "${fechaRegresoTxt}".`);
  }

  const horaRegresoRaw = row.getCell(COL_HORA_REGRESO).value;
  const horaRegresoTxt = cellStr(horaRegresoRaw).trim();
  const horaRegresoExcel = normalizarHora(horaRegresoRaw);
  if (!horaRegresoExcel && horaRegresoTxt) {
    errores.push(`Hora regreso estimado inválida: "${horaRegresoTxt}".`);
  }

  // "Regreso incompleto" (fecha sin hora, u hora sin fecha) solo se evalúa
  // cuando NINGUNA de las dos mitades provistas era inválida por formato
  // (eso ya se reportó arriba) — evita reportar dos errores redundantes
  // sobre el mismo dato roto.
  const fechaRegresoInvalidaFormato = Boolean(fechaRegresoTxt) && !fechaRegresoExcel;
  const horaRegresoInvalidaFormato = Boolean(horaRegresoTxt) && !horaRegresoExcel;
  if (!fechaRegresoInvalidaFormato && !horaRegresoInvalidaFormato) {
    const fechaOk = Boolean(fechaRegresoExcel);
    const horaOk = Boolean(horaRegresoExcel);
    if (fechaOk !== horaOk) {
      errores.push(
        fechaOk
          ? "Regreso estimado incompleto: falta la hora de regreso."
          : "Regreso estimado incompleto: falta la fecha de regreso.",
      );
    } else if (fechaOk && horaOk && fechaSalidaExcel) {
      // Mismo criterio que planes/route.ts: hora de salida ausente -> "00:00".
      const salidaCombinada = `${fechaSalidaExcel}T${horaSalidaExcel ?? "00:00"}`;
      const regresoCombinada = `${fechaRegresoExcel}T${horaRegresoExcel}`;
      if (regresoCombinada <= salidaCombinada) {
        errores.push("El regreso estimado debe ser posterior a la salida programada.");
      }
    }
  }

  const observacionesExcel = normalizarEspacios(cellStr(row.getCell(COL_OBSERVACIONES).value));

  return {
    filaExcel: rowIndex,
    fechaSalidaExcel,
    horaSalidaExcel,
    codigoRutaExcel,
    clienteExcel,
    pilotoCodigoExcel,
    placaExcel,
    auxiliar1CodigoExcel,
    auxiliar2CodigoExcel,
    tipoTrasladoExcel,
    tarifaExcel: tarifa.valor,
    fechaRegresoExcel,
    horaRegresoExcel,
    observacionesExcel,
    erroresSintacticos: errores,
  };
}

/**
 * Lee la hoja "Programacion" y devuelve una fila por viaje a crear, en el
 * mismo orden del archivo. NO consulta BD, NO valida catálogo — solo
 * normaliza formato y aplica las validaciones sintácticas puras (ver
 * `FilaProgramacionExcel.erroresSintacticos`). Lanza un Error (no
 * parcial, todo o nada) si: el archivo no es un .xlsx legible, no existe
 * la hoja "Programacion", algún encabezado no coincide con lo esperado, o
 * hay más de `MAX_FILAS_PROGRAMACION` filas útiles.
 */
export async function parsearExcelProgramacion(buffer: Buffer): Promise<FilaProgramacionExcel[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new Error("No se pudo leer el archivo. Debe ser un Excel .xlsx válido.");
  }

  const ws =
    wb.getWorksheet(HOJA_PROGRAMACION) ??
    wb.worksheets.find((w) => normalizarComparacion(w.name) === normalizarComparacion(HOJA_PROGRAMACION));
  if (!ws) {
    throw new Error(`No se encontró la hoja "${HOJA_PROGRAMACION}" en el archivo.`);
  }

  for (let i = 0; i < ENCABEZADOS_PROGRAMACION.length; i++) {
    const col = i + 1;
    const esperado = ENCABEZADOS_PROGRAMACION[i];
    const real = cellStr(ws.getRow(FILA_ENCABEZADO).getCell(col).value);
    if (normalizarComparacion(real) !== normalizarComparacion(esperado)) {
      throw new Error(
        `Encabezado inválido en la columna ${letraColumna(col)}: se esperaba "${esperado}" y se encontró "${real || "(vacío)"}". No modifique ni reordene las columnas de la hoja "${HOJA_PROGRAMACION}".`,
      );
    }
  }

  const filas: FilaProgramacionExcel[] = [];
  const ultimaFila = ws.rowCount;
  for (let rowIndex = FILA_INICIO_DATOS; rowIndex <= ultimaFila; rowIndex++) {
    const row = ws.getRow(rowIndex);
    const celdas = [
      row.getCell(COL_FECHA_SALIDA).value,
      row.getCell(COL_HORA_SALIDA).value,
      row.getCell(COL_CODIGO_RUTA).value,
      row.getCell(COL_CLIENTE).value,
      row.getCell(COL_PILOTO).value,
      row.getCell(COL_PLACA).value,
      row.getCell(COL_AUX1).value,
      row.getCell(COL_AUX2).value,
      row.getCell(COL_TIPO_TRASLADO).value,
      row.getCell(COL_TARIFA).value,
      row.getCell(COL_FECHA_REGRESO).value,
      row.getCell(COL_HORA_REGRESO).value,
      row.getCell(COL_OBSERVACIONES).value,
    ];
    if (celdas.every((v) => !cellStr(v).trim())) continue; // fila completamente vacía: se ignora

    const codigoRutaTxt = normalizarEspacios(cellStr(row.getCell(COL_CODIGO_RUTA).value));
    if (normalizarComparacion(codigoRutaTxt) === CODIGO_EJEMPLO) continue; // fila de ejemplo de la plantilla

    if (filas.length >= MAX_FILAS_PROGRAMACION) {
      throw new Error(
        `El archivo supera el límite de ${MAX_FILAS_PROGRAMACION} filas por importación.`,
      );
    }
    filas.push(parsearFila(ws, rowIndex));
  }

  return filas;
}

// ---------------------------------------------------------------------
// Catálogos de referencia (consultan BD — solo para poblar la plantilla,
// NUNCA se usan en `parsearExcelProgramacion`). Cada uno reutiliza
// EXACTAMENTE los criterios de "activo/elegible" que ya usa el resto de
// Programación — no se inventa ningún filtro nuevo.
// ---------------------------------------------------------------------

export type CatalogoRuta = {
  codigo: string;
  nombre: string;
  clienteNombre: string;
  clienteNit: string;
  /** = tms_cliente_rutas.tarifa_referencia, que el sistema ya mantiene sincronizado con el monto de la tarifa predeterminada activa (ver ruta-tarifas.ts). */
  tarifaVigente: number | null;
  destino: string;
};

async function catalogoRutas(empresaId: number): Promise<CatalogoRuta[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT r.codigo, r.nombre, c.nombre AS cliente_nombre, c.nit AS cliente_nit,
            r.tarifa_referencia, r.destino_descripcion
     FROM tms_cliente_rutas r
     JOIN tms_clientes c ON c.id = r.cliente_id
     WHERE r.empresa_id = ? AND r.activo = 1
     ORDER BY r.codigo`,
    [empresaId],
  );
  return rows.map((r) => ({
    codigo: String(r.codigo),
    nombre: r.nombre != null ? String(r.nombre) : "",
    clienteNombre: String(r.cliente_nombre ?? ""),
    clienteNit: r.cliente_nit != null ? String(r.cliente_nit) : "",
    tarifaVigente: r.tarifa_referencia != null ? Number(r.tarifa_referencia) : null,
    destino: r.destino_descripcion != null ? String(r.destino_descripcion) : "",
  }));
}

export type CatalogoVehiculo = {
  placa: string;
  marca: string;
  modelo: string;
  estado: string;
  propia: boolean;
};

async function catalogoVehiculos(empresaId: number): Promise<CatalogoVehiculo[]> {
  // Mismo criterio de disponibilidad que ya usa Programación al crear un
  // plan (listarDisponibilidadVehiculos) — se excluyen inactivas, pero SE
  // INCLUYEN las que están en_ruta/en_taller en este momento (marcadas
  // como tal): la disponibilidad real se revalida al importar, no al
  // descargar la plantilla (ver docs/TMS-IMPORTACION-PROGRAMACION-EXCEL-
  // 2-DISCOVERY-CAMPOS-CATALOGOS.md §7).
  const { vehiculos } = await listarDisponibilidadVehiculos(empresaId);
  return vehiculos
    .filter((v) => v.activo)
    .map((v) => ({
      placa: v.placa,
      marca: v.marca ?? "",
      modelo: v.modelo ?? "",
      estado: v.estadoDisponibilidad,
      propia: v.esPropio,
    }));
}

export type CatalogoEmpleado = {
  codigo: string;
  nombre: string;
  categoria: string;
};

async function catalogoEmpleados(empresaId: number): Promise<CatalogoEmpleado[]> {
  // Reutiliza EXACTAMENTE el mismo criterio que ya usa
  // .../rrhh/personal-ops/route.ts (rama tipo=Piloto / tipo=Auxiliar) para
  // decidir quién es elegible como piloto/auxiliar — unión de ambos
  // roles. A propósito NO se reutiliza el fallback de ese endpoint ("si
  // no hay categoria_ops, listar TODOS los activos"): ese fallback existe
  // ahí para no dejar sin opciones al selector manual cuando una empresa
  // no ha migrado categoria_ops; aquí el usuario pidió explícitamente
  // excluir administrativos/otros puestos del catálogo de referencia, así
  // que una empresa sin categoria_ops simplemente vería este catálogo
  // vacío en vez de listar personal no elegible. La consulta vive
  // duplicada aquí (personal-ops/route.ts no exporta esta lógica) — si en
  // el futuro se necesita una tercera vez, valdría la pena extraerla a un
  // helper compartido (mismo criterio que ya se hizo en PR 1 con
  // personalDesdeEmpleado); no se hace en este PR para no ampliar su
  // alcance sin autorización.
  const rows = await query<RowDataPacket[]>(
    `SELECT codigo, nombre, puesto, categoria_ops
     FROM empleados
     WHERE empresa_id = ? AND estado = 'Activo'
       AND (
         categoria_ops IN ('Piloto', 'Auxiliar')
         OR LOWER(COALESCE(puesto, '')) LIKE '%piloto%'
         OR LOWER(COALESCE(puesto, '')) LIKE '%auxiliar%'
         OR LOWER(COALESCE(categoria_ops, '')) LIKE '%piloto%'
         OR LOWER(COALESCE(categoria_ops, '')) LIKE '%auxiliar%'
       )
     ORDER BY nombre`,
    [empresaId],
  );
  return rows.map((r) => ({
    codigo: String(r.codigo),
    nombre: String(r.nombre),
    categoria: r.categoria_ops != null && String(r.categoria_ops).trim() ? String(r.categoria_ops) : String(r.puesto ?? ""),
  }));
}

export type CatalogoCliente = { nombre: string; nit: string };

async function catalogoClientes(empresaId: number): Promise<CatalogoCliente[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT nombre, nit FROM tms_clientes WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre`,
    [empresaId],
  );
  return rows.map((r) => ({ nombre: String(r.nombre ?? ""), nit: r.nit != null ? String(r.nit) : "" }));
}

// ---------------------------------------------------------------------
// Generación de la plantilla (6 hojas, dinámica por empresa)
// ---------------------------------------------------------------------

const COLOR_HEADER = "FF1F4E78";
const COLOR_EJEMPLO = "FFFFF2CC";
const COLOR_CATALOGO_HEADER = "FF4472C4";
const COLOR_AYUDA_HEADER = "FFD9EAF7";

function construirHojaProgramacion(wb: ExcelJS.Workbook): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(HOJA_PROGRAMACION, {
    views: [{ state: "frozen", ySplit: FILA_ENCABEZADO, showGridLines: true }],
    properties: { tabColor: { argb: COLOR_HEADER } },
  });

  ENCABEZADOS_PROGRAMACION.forEach((valor, index) => {
    ws.getCell(FILA_ENCABEZADO, index + 1).value = valor;
  });
  ws.getRow(FILA_ENCABEZADO).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(FILA_ENCABEZADO).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_HEADER } };
  ws.getRow(FILA_ENCABEZADO).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  ws.getRow(FILA_ENCABEZADO).height = 32;

  const anchos = [13, 11, 13, 26, 13, 13, 15, 15, 18, 12, 15, 13, 30];
  anchos.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  ws.getColumn(COL_FECHA_SALIDA).numFmt = "yyyy-mm-dd";
  ws.getColumn(COL_HORA_SALIDA).numFmt = "h:mm AM/PM";
  ws.getColumn(COL_TARIFA).numFmt = "Q#,##0.00";
  ws.getColumn(COL_FECHA_REGRESO).numFmt = "yyyy-mm-dd";
  ws.getColumn(COL_HORA_REGRESO).numFmt = "h:mm AM/PM";

  // 2 filas de ejemplo, claramente marcadas — el parser las ignora por el
  // marcador CODIGO_EJEMPLO en la columna Código ruta (mismo criterio que
  // rutas-import-excel.ts).
  const ejemplo1 = [
    "2026-09-20", "08:00", "EJEMPLO-NO-IMPORTAR", "Acme S.A. (o su NIT)", "1234",
    "P-123ABC", "5678", "", "Carga completa", 1500, "2026-09-20", "17:00", "Ejemplo — no se importa",
  ];
  const ejemplo2 = [
    "2026-09-21", "02:30 PM", "EJEMPLO-NO-IMPORTAR", "Acme S.A.", "1234",
    "P-456XYZ", "5678", "9012", "Paquetería", 800, "2026-09-21", "06:00 PM", "Ejemplo — no se importa",
  ];
  [ejemplo1, ejemplo2].forEach((fila, i) => {
    const rowNum = FILA_EJEMPLO_1 + i;
    fila.forEach((valor, colIndex) => {
      ws.getCell(rowNum, colIndex + 1).value = valor as ExcelJS.CellValue;
    });
    ws.getRow(rowNum).font = { name: "Calibri", size: 10, italic: true, color: { argb: "FF595959" } };
    ws.getRow(rowNum).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_EJEMPLO } };
  });

  ws.autoFilter = { from: "A1", to: `M${FILA_INICIO_DATOS + MAX_FILAS_PROGRAMACION}` };
  return ws;
}

function construirHojaCatalogo(
  wb: ExcelJS.Workbook,
  nombre: string,
  encabezados: string[],
  filas: unknown[][],
  anchos: number[],
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(nombre, {
    views: [{ state: "frozen", ySplit: 1, showGridLines: true }],
    properties: { tabColor: { argb: COLOR_CATALOGO_HEADER } },
  });
  encabezados.forEach((valor, index) => {
    ws.getCell(1, index + 1).value = valor;
  });
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_CATALOGO_HEADER } };
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  anchos.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
  filas.forEach((fila, i) => {
    fila.forEach((valor, colIndex) => {
      ws.getCell(2 + i, colIndex + 1).value = valor as ExcelJS.CellValue;
    });
  });
  return ws;
}

function construirHojaInstrucciones(wb: ExcelJS.Workbook): void {
  const ws = wb.addWorksheet("Instrucciones", {
    views: [{ state: "frozen", ySplit: 3, showGridLines: false }],
    properties: { tabColor: { argb: "FF70AD47" } },
  });
  ws.getCell("A1").value = "CÓMO IMPORTAR PROGRAMACIÓN DE FORMA MASIVA";
  ws.getRow(1).font = { bold: true, size: 15 };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_AYUDA_HEADER } };
  ws.getRow(1).height = 38;
  ws.getCell("A2").value =
    'Llene un viaje por fila en la hoja "Programacion". Una misma ruta puede repetirse varias veces con pilotos/unidades diferentes.';
  ws.getRow(2).alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(2).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_AYUDA_HEADER } };
  ws.getRow(3).values = ["Campo", "Qué debe escribir"];
  ws.getRow(3).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR_CATALOGO_HEADER } };
  [
    ["Fecha salida *", 'Fecha del viaje. Formato "AAAA-MM-DD" (ej. 2026-09-20) o el que use su Excel — también acepta fecha escrita como 20/09/2026.'],
    ["Hora salida", 'Hora de salida. Puede escribir 24h ("14:30") o 12h con AM/PM ("02:30 PM"). Puede dejarla en blanco.'],
    ["Código ruta *", 'Código exacto de la ruta, tal como aparece en la hoja "Rutas" de este mismo archivo. Debe existir y estar activa en el sistema.'],
    ["Cliente", 'Solo de contraste: escriba el NIT del cliente si lo tiene registrado (ver hoja "Clientes"), o su nombre si no. El cliente real del viaje lo determina el Código de ruta, no este campo.'],
    ["Código piloto *", 'Código de empleado (RRHH) del piloto, tal como aparece en la hoja "Empleados". Debe existir y estar activo/habilitado.'],
    ["Placa *", 'Placa exacta de la unidad, tal como aparece en la hoja "Vehiculos".'],
    ["Código auxiliar 1 / 2", "Códigos de empleado de los auxiliares, si aplica. Ambos son opcionales."],
    ["Tipo traslado", "Texto libre, por ejemplo: Carga completa, Paquetería."],
    ["Tarifa GTQ", "Monto en quetzales. Se contrastará contra la tarifa vigente del sistema para esa ruta al momento de importar."],
    ["Fecha/Hora regreso estimado", "Ambas juntas u ambas vacías — no se acepta solo una de las dos. Debe ser posterior a la fecha/hora de salida."],
    ["Observaciones", "Texto libre, opcional."],
    ["Código de plan", "NO existe esta columna — el sistema genera el código de cada viaje automáticamente al importar."],
    ["Hojas Rutas / Vehiculos / Empleados / Clientes", "Son SOLO de referencia, una fotografía del momento en que descargó este archivo. Editarlas no tiene ningún efecto: el sistema siempre vuelve a consultar la base de datos real al importar."],
    ["Esta importación NO crea catálogo", "Rutas, clientes, empleados, pilotos, auxiliares, unidades y tarifas deben existir previamente en el sistema. Si algo no existe, esa fila se rechaza."],
    ["Fila azul", "Nombre de cada columna. No la elimine ni reordene las columnas."],
    ["Filas amarillas", "Son únicamente un ejemplo y NO se importan. Empiece a ingresar sus viajes debajo de esas 2 filas."],
    ["Límite", `Máximo ${MAX_FILAS_PROGRAMACION} filas por archivo.`],
    ["Proceso", "1) Descargue este formato. 2) Llene un viaje por fila. 3) Guarde como .xlsx. 4) Súbalo y revise la vista previa de errores antes de confirmar."],
  ].forEach((row) => ws.addRow(row));
  ws.columns = [{ width: 32 }, { width: 100 }];
  ws.eachRow((row) => {
    row.alignment = { vertical: "top", wrapText: true };
  });
  ws.getColumn(1).font = { bold: true };
}

/**
 * Rango con nombre a nivel de libro (workbook.definedNames) apuntando a
 * la columna A de una hoja de catálogo — patrón más robusto entre
 * versiones de Excel/LibreOffice que una fórmula de lista inline
 * cross-hoja (ver docs/TMS-IMPORTACION-PROGRAMACION-EXCEL-2-DISCOVERY-
 * CAMPOS-CATALOGOS.md §7). Si el catálogo está vacío, el rango apunta a
 * una sola celda en blanco (A2) — un dataValidation de tipo lista con
 * rango vacío no genera error en Excel, solo un desplegable sin
 * opciones.
 */
function definirRangoLista(wb: ExcelJS.Workbook, nombre: string, hoja: string, cantidadFilas: number): void {
  const filaFin = cantidadFilas > 0 ? 1 + cantidadFilas : 2;
  wb.definedNames.add(`${hoja}!$A$2:$A$${filaFin}`, nombre);
}

/**
 * Aplica el dropdown a un rango de filas de una columna de
 * "Programacion". `showErrorMessage: false` a propósito: el dropdown es
 * SOLO ayuda visual (decisión aprobada) — Excel nunca debe impedir
 * escribir un valor que no esté en la lista (puede ser válido en BD
 * aunque no aparezca en esta fotografía de referencia). El backend
 * (PR 4/5) es quien valida de verdad, siempre contra BD fresca.
 */
function aplicarDropdown(ws: ExcelJS.Worksheet, columna: number, nombreLista: string): void {
  for (let fila = FILA_INICIO_DATOS; fila <= FILA_INICIO_DATOS + MAX_FILAS_PROGRAMACION; fila++) {
    ws.getCell(fila, columna).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [nombreLista],
      showErrorMessage: false,
    };
  }
}

/**
 * Genera la plantilla oficial de importación masiva de Programación:
 * "Programacion" (hoja de trabajo, 13 columnas) + 4 hojas de catálogo de
 * referencia (Rutas/Vehiculos/Empleados/Clientes, generadas con datos
 * REALES y ACTUALES de la empresa) + "Instrucciones". Los catálogos
 * NUNCA son fuente de verdad al importar — son solo ayuda de llenado; el
 * backend siempre revalida contra BD fresca en la fase de importación
 * (fuera de alcance de este módulo, ver PR 3/4/5).
 */
export async function generarPlantillaProgramacion(empresaId: number): Promise<Buffer> {
  const [rutas, vehiculos, empleados, clientes] = await Promise.all([
    catalogoRutas(empresaId),
    catalogoVehiculos(empresaId),
    catalogoEmpleados(empresaId),
    catalogoClientes(empresaId),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SITSA Plataforma";
  wb.subject = "Modelo para importación masiva de Programación";

  const wsProgramacion = construirHojaProgramacion(wb);

  construirHojaCatalogo(
    wb,
    "Rutas",
    ["Código ruta", "Nombre / descripción", "Cliente", "NIT del cliente", "Tarifa vigente (Q)", "Destino habitual"],
    rutas.map((r) => [r.codigo, r.nombre, r.clienteNombre, r.clienteNit, r.tarifaVigente, r.destino]),
    [14, 26, 26, 16, 16, 50],
  );
  construirHojaCatalogo(
    wb,
    "Vehiculos",
    ["Placa", "Marca", "Modelo", "Estado actual", "Propia / compartida"],
    vehiculos.map((v) => [v.placa, v.marca, v.modelo, v.estado, v.propia ? "Propia" : "Compartida"]),
    [14, 16, 16, 16, 18],
  );
  construirHojaCatalogo(
    wb,
    "Empleados",
    ["Código", "Nombre", "Categoría operativa"],
    empleados.map((e) => [e.codigo, e.nombre, e.categoria]),
    [14, 30, 20],
  );
  construirHojaCatalogo(
    wb,
    "Clientes",
    ["Nombre", "NIT"],
    clientes.map((c) => [c.nombre, c.nit]),
    [36, 16],
  );
  construirHojaInstrucciones(wb);

  definirRangoLista(wb, "LISTA_RUTAS_CODIGOS", "Rutas", rutas.length);
  definirRangoLista(wb, "LISTA_VEHICULOS_PLACAS", "Vehiculos", vehiculos.length);
  definirRangoLista(wb, "LISTA_EMPLEADOS_CODIGOS", "Empleados", empleados.length);

  aplicarDropdown(wsProgramacion, COL_CODIGO_RUTA, "LISTA_RUTAS_CODIGOS");
  aplicarDropdown(wsProgramacion, COL_PLACA, "LISTA_VEHICULOS_PLACAS");
  aplicarDropdown(wsProgramacion, COL_PILOTO, "LISTA_EMPLEADOS_CODIGOS");
  aplicarDropdown(wsProgramacion, COL_AUX1, "LISTA_EMPLEADOS_CODIGOS");
  aplicarDropdown(wsProgramacion, COL_AUX2, "LISTA_EMPLEADOS_CODIGOS");

  return Buffer.from(await wb.xlsx.writeBuffer());
}

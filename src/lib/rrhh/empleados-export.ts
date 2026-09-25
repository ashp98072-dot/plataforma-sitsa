import ExcelJS from "exceljs";
import type { Empleado } from "./empleados";
import { formatearFechaVisible } from "./dates";
import { tablaAPdf } from "@/lib/rrhh/export-files";
import { CATEGORIAS_OPS, PUESTOS_MONACO } from "./categorias-ops";
import { FORMAS_PAGO, TIPOS_CONTRATO } from "./contratos-pago";

/** Columnas de plantilla / import (cuestionario Monaco + compat). */
export const HEADERS_EMPLEADOS = [
  "codigo",
  "dpi",
  "primer_nombre",
  "segundo_nombre",
  "primer_apellido",
  "segundo_apellido",
  "apellido_casada",
  "nombre",
  "nit",
  "igss",
  "irtra",
  "sexo",
  "fecha_nacimiento",
  "puesto",
  "area",
  "tipo_horario",
  "tipo_contrato",
  "forma_pago",
  "profesion",
  "fecha_contratacion",
  "fecha_ingreso",
  "hora_entrada_teorica",
  "hora_salida_teorica",
  "estado_laboral",
  "sueldo_base",
  "bono_incentivo",
  "bono_herramientas",
  "telefono",
  "email",
  "direccion",
  "pais_origen",
  "municipio",
  "etnia",
  "religion",
  "idioma",
  "licencia_numero",
  "licencia_tipo",
  "licencia_vence",
  "cuenta_bancaria",
  "tipo_cuenta",
  "banco",
  "contacto_emergencia",
  "observaciones",
] as const;

// ------------------------------------------------------------------------------------------------ FUENTE ÚNICA DEL EXCEL
/**
 * PLANTILLA y EXPORTACIÓN de empleados se construyen desde ESTA misma definición (hoja, encabezados, orden, formatos, anchos,
 * catálogos, instrucciones y mapeo de filas): la exportación es directamente reimportable y esa compatibilidad es una garantía
 * del código (ver empleados-export-roundtrip.test.ts), no una coincidencia. Un encabezado nuevo en HEADERS_EMPLEADOS obliga (por
 * tipos) a declarar su formato aquí.
 */
export const HOJA_EMPLEADOS = "Empleados";
/** Nombre que usaban las exportaciones anteriores: el importador lo sigue aceptando (retrocompatibilidad). */
export const HOJA_EMPLEADOS_LEGADO = "Personal";
export const HOJA_CATALOGOS = "Catalogos";
export const HOJA_INSTRUCCIONES = "Instrucciones";

type HeaderEmpleado = (typeof HEADERS_EMPLEADOS)[number];
type FormatoColumna = { ancho: number; tipo: "texto" | "fecha" | "hora" | "monto"; lista?: readonly string[] };
const LICENCIAS_TIPO = ["A", "B", "C", "M"] as const;
const LISTAS = {
  sexo: ["M", "F"],
  tipoHorario: ["Fijo", "Variable"],
  tipoContrato: TIPOS_CONTRATO.map((t) => t.value),
  formaPago: FORMAS_PAGO.map((f) => f.value),
  estado: ["Activo", "Baja"],
  licencia: LICENCIAS_TIPO,
} as const;

export const FORMATO_COLUMNAS: Record<HeaderEmpleado, FormatoColumna> = {
  codigo: { ancho: 16, tipo: "texto" }, dpi: { ancho: 16, tipo: "texto" },
  primer_nombre: { ancho: 16, tipo: "texto" }, segundo_nombre: { ancho: 16, tipo: "texto" },
  primer_apellido: { ancho: 16, tipo: "texto" }, segundo_apellido: { ancho: 16, tipo: "texto" },
  apellido_casada: { ancho: 16, tipo: "texto" }, nombre: { ancho: 30, tipo: "texto" },
  nit: { ancho: 14, tipo: "texto" }, igss: { ancho: 14, tipo: "texto" }, irtra: { ancho: 14, tipo: "texto" },
  sexo: { ancho: 8, tipo: "texto", lista: LISTAS.sexo }, fecha_nacimiento: { ancho: 14, tipo: "fecha" },
  puesto: { ancho: 20, tipo: "texto" }, area: { ancho: 20, tipo: "texto" },
  tipo_horario: { ancho: 12, tipo: "texto", lista: LISTAS.tipoHorario },
  tipo_contrato: { ancho: 14, tipo: "texto", lista: LISTAS.tipoContrato },
  forma_pago: { ancho: 15, tipo: "texto", lista: LISTAS.formaPago },
  profesion: { ancho: 18, tipo: "texto" }, fecha_contratacion: { ancho: 16, tipo: "fecha" }, fecha_ingreso: { ancho: 14, tipo: "fecha" },
  hora_entrada_teorica: { ancho: 12, tipo: "hora" }, hora_salida_teorica: { ancho: 12, tipo: "hora" },
  estado_laboral: { ancho: 13, tipo: "texto", lista: LISTAS.estado },
  sueldo_base: { ancho: 13, tipo: "monto" }, bono_incentivo: { ancho: 14, tipo: "monto" }, bono_herramientas: { ancho: 16, tipo: "monto" },
  telefono: { ancho: 14, tipo: "texto" }, email: { ancho: 26, tipo: "texto" }, direccion: { ancho: 30, tipo: "texto" },
  pais_origen: { ancho: 14, tipo: "texto" }, municipio: { ancho: 16, tipo: "texto" }, etnia: { ancho: 12, tipo: "texto" },
  religion: { ancho: 12, tipo: "texto" }, idioma: { ancho: 12, tipo: "texto" },
  licencia_numero: { ancho: 16, tipo: "texto" }, licencia_tipo: { ancho: 12, tipo: "texto", lista: LISTAS.licencia },
  licencia_vence: { ancho: 14, tipo: "fecha" }, cuenta_bancaria: { ancho: 18, tipo: "texto" }, tipo_cuenta: { ancho: 14, tipo: "texto" },
  banco: { ancho: 16, tipo: "texto" }, contacto_emergencia: { ancho: 24, tipo: "texto" }, observaciones: { ancho: 30, tipo: "texto" },
};

// ---- seguridad de texto Excel
/**
 * Texto de la BD que EMPIEZA con `=`, `@`, tab/CR (o `+`/`-` seguidos de algo que no sea número/teléfono) se guarda con un `'`
 * delante para que ninguna hoja de cálculo lo interprete como fórmula. El importador quita ese `'` (desprotegerTextoExcel), así
 * el ciclo exportar → importar devuelve EXACTAMENTE el mismo texto. Un texto que ya empieza con `'` + carácter peligroso
 * también se antepone otro `'` para que la ida y vuelta sea exacta.
 */
export function protegerTextoExcel(valor: string | null | undefined): string {
  const v = String(valor ?? "");
  if (/^'+[=+\-@\t\r]/.test(v)) return `'${v}`;
  if (/^[=@\t\r]/.test(v)) return `'${v}`;
  if (/^[+-]/.test(v) && v.length > 1 && !/^[+-][\d\s().-]*$/.test(v)) return `'${v}`;
  return v;
}
export function desprotegerTextoExcel(valor: string): string {
  return /^'+[=+\-@\t\r]/.test(valor) ? valor.slice(1) : valor;
}

/** HH:MM (o HH:MM:SS si tiene segundos ≠ 0) — el importador lo normaliza al mismo valor lógico. */
export function horaParaExcel(h: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(h ?? "").trim());
  if (!m) return "";
  const base = `${m[1].padStart(2, "0")}:${m[2]}`;
  return m[3] && m[3] !== "00" ? `${base}:${m[3]}` : base;
}

/** ÚNICO mapeo Empleado → fila (orden = HEADERS_EMPLEADOS). Importes como NÚMERO (exactos), fechas DD/MM/AAAA, horas HH:MM. */
export function filaExcelDeEmpleado(e: Empleado): (string | number)[] {
  const t = (v: string | null | undefined) => protegerTextoExcel(v ?? "");
  const fila: Record<HeaderEmpleado, string | number> = {
    codigo: t(e.codigo), dpi: t(e.dpi), primer_nombre: t(e.primerNombre), segundo_nombre: t(e.segundoNombre),
    primer_apellido: t(e.primerApellido), segundo_apellido: t(e.segundoApellido), apellido_casada: t(e.apellidoCasada),
    nombre: t(e.nombre), nit: t(e.nit), igss: t(e.igss), irtra: t(e.irtra), sexo: t(e.sexo),
    fecha_nacimiento: formatearFechaVisible(e.fechaNacimiento), puesto: t(e.puesto), area: t(e.categoriaOps),
    tipo_horario: t(e.tipoHorario), tipo_contrato: t(e.tipoContrato), forma_pago: t(e.formaPago), profesion: t(e.profesion),
    fecha_contratacion: formatearFechaVisible(e.fechaAlta), fecha_ingreso: formatearFechaVisible(e.fechaInicioLaboral),
    hora_entrada_teorica: horaParaExcel(e.horaEntradaTeorica), hora_salida_teorica: horaParaExcel(e.horaSalidaTeorica),
    estado_laboral: t(e.estado),
    sueldo_base: e.sueldoBase != null ? Number(e.sueldoBase) : "", bono_incentivo: e.bonoIncentivo != null ? Number(e.bonoIncentivo) : "",
    bono_herramientas: e.bonoHerramientas != null ? Number(e.bonoHerramientas) : "",
    telefono: t(e.telefono), email: t(e.email), direccion: t(e.direccion), pais_origen: t(e.paisOrigen), municipio: t(e.municipio),
    etnia: t(e.etnia), religion: t(e.religion), idioma: t(e.idioma), licencia_numero: t(e.licenciaNumero), licencia_tipo: t(e.licenciaTipo),
    licencia_vence: formatearFechaVisible(e.licenciaVence), cuenta_bancaria: t(e.cuentaBancaria), tipo_cuenta: t(e.tipoCuenta),
    banco: t(e.banco), contacto_emergencia: t(e.contactoEmergencia), observaciones: t(e.observaciones),
  };
  return HEADERS_EMPLEADOS.map((h) => fila[h]);
}

/** Empleado de ejemplo de la plantilla (pasa por el MISMO mapeo que la exportación). */
const EMPLEADO_EJEMPLO: Empleado = {
  id: 0, numeroEmpleado: "", codigo: "DPI001", dpi: "DPI001", primerNombre: "Juan", segundoNombre: "Carlos", primerApellido: "Pérez",
  segundoApellido: "López", apellidoCasada: "", nombre: "Juan Carlos Pérez López", nit: "1234567-8", igss: "1234567890", irtra: "IRTRA01",
  sexo: "M", fechaNacimiento: "1990-03-15", puesto: "Piloto", categoriaOps: "Transporte", tipoHorario: "Fijo", tipoContrato: "fijo",
  formaPago: "transferencia", profesion: "Piloto", fechaAlta: "2024-01-01", fechaInicioLaboral: "2024-01-01", horaEntradaTeorica: "07:00:00",
  horaSalidaTeorica: "16:00:00", estado: "Activo", sueldoBase: 3500, bonoIncentivo: 250, bonoHerramientas: 0, telefono: "5555-1234",
  email: "correo@ejemplo.com", direccion: "Ciudad de Guatemala", paisOrigen: "Guatemala", municipio: "Guatemala", etnia: "Ladino",
  religion: "", idioma: "Español", licenciaNumero: "", licenciaTipo: "", licenciaVence: null, cuentaBancaria: "", tipoCuenta: "monetaria",
  banco: "", contactoEmergencia: "", observaciones: "",
};

const INSTRUCCIONES_COMUNES = [
  "Este archivo puede editarse y volver a importarse directamente desde RRHH > Empleados > Importar Excel.",
  "El código identifica al empleado. No lo cambies si deseas actualizar la ficha existente.",
  "Las celdas vacías o placeholders (48, N/A, NA, Pendiente, 0000, -, —) no eliminan información existente durante una actualización: vacío = conservar el dato actual.",
  "Si reemplazas un placeholder por un dato real, el dato se actualiza.",
  "Supervisores, fecha de egreso, fotografía, documentos y configuración de horas extra se gestionan desde la ficha y no se modifican al reimportar este Excel.",
  "Fechas: DD/MM/AAAA · Horas: HH:MM · Importes: números (por ejemplo 4002.28).",
  "Si el código del archivo no existe pero el DPI ya pertenece a otro empleado, la fila se bloquea (no se crea un duplicado): corrige el código.",
];

function construirLibroEmpleados(filas: (string | number)[][], modo: "plantilla" | "exportacion"): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(HOJA_EMPLEADOS);
  ws.addRow([...HEADERS_EMPLEADOS]);
  ws.getRow(1).font = { bold: true };
  for (const f of filas) ws.addRow(f);
  HEADERS_EMPLEADOS.forEach((h, i) => {
    const fmt = FORMATO_COLUMNAS[h];
    const col = ws.getColumn(i + 1);
    col.width = fmt.ancho;
    // Texto explícito en identificadores/fechas/horas (evita que Excel convierta DPI o fechas); importes numéricos con 2 decimales.
    const numFmt = fmt.tipo === "monto" ? "0.00" : "@";
    for (let r = 2; r <= ws.rowCount; r++) ws.getCell(r, i + 1).numFmt = numFmt;
  });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  // Desplegables (advertencia, no bloqueo: un valor antiguo fuera de catálogo no se rechaza).
  const ultima = Math.max(ws.rowCount, 300);
  HEADERS_EMPLEADOS.forEach((h, i) => {
    const lista = FORMATO_COLUMNAS[h].lista;
    if (!lista) return;
    for (let r = 2; r <= ultima; r++) {
      ws.getCell(r, i + 1).dataValidation = {
        type: "list", allowBlank: true, formulae: [`"${lista.join(",")}"`], showErrorMessage: true, errorStyle: "warning",
        errorTitle: "Valor fuera de catálogo", error: `Valores esperados: ${lista.join(", ")}`,
      };
    }
  });

  const cat = wb.addWorksheet(HOJA_CATALOGOS);
  const columnas: [string, readonly string[]][] = [
    ["area", CATEGORIAS_OPS], ["puesto", PUESTOS_MONACO], ["sexo", LISTAS.sexo], ["tipo_contrato", LISTAS.tipoContrato],
    ["forma_pago", LISTAS.formaPago], ["estado_laboral", LISTAS.estado], ["tipo_horario", LISTAS.tipoHorario], ["licencia_tipo", LISTAS.licencia],
  ];
  cat.addRow(columnas.map(([n]) => n));
  cat.getRow(1).font = { bold: true };
  const max = Math.max(...columnas.map(([, v]) => v.length));
  for (let i = 0; i < max; i++) cat.addRow(columnas.map(([, v]) => v[i] ?? ""));
  cat.columns = columnas.map(() => ({ width: 22 }));

  const ins = wb.addWorksheet(HOJA_INSTRUCCIONES);
  ins.addRow([modo === "exportacion" ? "Empleados exportados — archivo de actualización" : "Plantilla de empleados"]);
  ins.getRow(1).font = { bold: true };
  for (const l of INSTRUCCIONES_COMUNES) ins.addRow([l]);
  ins.getColumn(1).width = 150;
  return wb;
}

export async function generarPlantillaEmpleados(): Promise<Buffer> {
  return Buffer.from(await construirLibroEmpleados([filaExcelDeEmpleado(EMPLEADO_EJEMPLO)], "plantilla").xlsx.writeBuffer());
}

export async function exportarEmpleadosExcel(
  empleados: Empleado[],
  empresaNombre: string,
): Promise<Buffer> {
  void empresaNombre;
  return Buffer.from(await construirLibroEmpleados(empleados.map(filaExcelDeEmpleado), "exportacion").xlsx.writeBuffer());
}

export async function exportarEmpleadosPdf(
  empleados: Empleado[],
  empresaNombre: string,
): Promise<Buffer> {
  return tablaAPdf({
    title: `SITSA — Empleados`,
    subtitle: `${empresaNombre} · ${empleados.length} registro(s)`,
    headers: [
      "Código",
      "Nombre",
      "Puesto",
      "Área",
      "Horario",
      "Estado",
      "Contrato",
      "Entrada lab.",
    ],
    rows: empleados.map((e) => [
      e.codigo,
      e.nombre,
      e.puesto || "—",
      e.categoriaOps || "—",
      e.tipoHorario,
      e.estado,
      formatearFechaVisible(e.fechaAlta) || "—",
      formatearFechaVisible(e.fechaInicioLaboral) || "—",
    ]),
    modo: "tabla",
    layout: "landscape",
  });
}

/**
 * Campos de FilaImportEmpleado cuyo valor final el parser puede haber
 * generado por DEFAULT (columna ausente o celda vacía en el Excel), en
 * vez de venir de un valor explícito. IMPORT-EMPLEADOS-SEGURA-2: una
 * reimportación NUNCA debe sobreescribir el valor real ya guardado en
 * la base con uno de estos defaults — ver
 * FilaImportEmpleado.camposConDefault y
 * empleados-import.ts#fusionarEmpleadoImport().
 */
export type CampoConDefaultImport =
  | "tipoHorario"
  | "estado"
  | "tipoContrato"
  | "formaPago"
  | "horaEntradaTeorica"
  | "horaSalidaTeorica";

export type FilaImportEmpleado = {
  /** Número de fila en el Excel (1 = encabezado). */
  filaExcel: number;
  codigo: string;
  nombre: string;
  dpi: string;
  /**
   * true si la columna `dpi` vino VACÍA y el parser usó el código como DPI (compatibilidad con plantillas donde codigo = DPI).
   * En un empleado EXISTENTE ese valor derivado NO debe escribirse como su DPI (contaminaría una ficha cuyo DPI está vacío).
   */
  dpiDesdeCodigo?: boolean;
  primerNombre: string;
  segundoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  apellidoCasada: string;
  nit: string;
  igss: string;
  irtra: string;
  sexo: string;
  fechaNacimiento: string;
  puesto: string;
  categoriaOps: string;
  tipoHorario: "Fijo" | "Variable";
  tipoContrato: string;
  formaPago: string;
  profesion: string;
  fechaAlta: string;
  fechaInicioLaboral: string | null;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: "Activo" | "Baja";
  sueldoBase: number | null;
  bonoIncentivo: number | null;
  bonoHerramientas: number | null;
  telefono: string;
  email: string;
  direccion: string;
  paisOrigen: string;
  municipio: string;
  etnia: string;
  religion: string;
  idioma: string;
  licenciaNumero: string;
  licenciaTipo: string;
  licenciaVence: string;
  cuentaBancaria: string;
  tipoCuenta: string;
  banco: string;
  contactoEmergencia: string;
  observaciones: string;
  /**
   * Campos de ESTA fila cuyo valor de arriba viene de un DEFAULT del
   * parser (columna ausente o celda vacía), no de un dato explícito del
   * Excel. Ausencia de columna != valor default: por ejemplo, si el
   * Excel no trae "tipo_horario", `tipoHorario` arriba vale "Fijo" para
   * poder dar de ALTA a un empleado nuevo, pero `camposConDefault` lo
   * marca para que una reimportación sepa que NO debe usar ese "Fijo"
   * para sobreescribir el "Variable" real de un empleado existente.
   */
  camposConDefault: Set<CampoConDefaultImport>;
};

export type FilaDescartadaImportEmpleado = {
  filaExcel: number;
  codigo: string;
  nombre: string;
  motivo: string;
};

export type ResultadoParseoEmpleados = {
  filas: FilaImportEmpleado[];
  descartadas: FilaDescartadaImportEmpleado[];
};

function cellStr(v: ExcelJS.CellValue | undefined): string {
  if (v == null) return "";
  if (typeof v === "string") return desprotegerTextoExcel(v.trim());
  if (typeof v === "object" && "text" in v) return String(v.text ?? "").trim();
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, "0");
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const y = v.getFullYear();
    return `${d}/${m}/${y}`;
  }
  return String(v).trim();
}

function cellNum(v: ExcelJS.CellValue | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = cellStr(v).replace(/,/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Igual que parsearPlantillaEmpleados(), pero además de las filas
 * válidas devuelve las filas descartadas por falta de identificador
 * (sin código/DPI, o sin nombre) — antes esas filas simplemente
 * desaparecían en silencio (`if (!codigo || !nombre) return;`) y el
 * importador nunca se enteraba de que existieron. También es la única
 * función que calcula `camposConDefault` por fila (ver
 * FilaImportEmpleado.camposConDefault).
 *
 * parsearPlantillaEmpleados() (abajo) es un envoltorio de compatibilidad
 * sobre esta función — mismo comportamiento exacto de antes para
 * cualquier otro llamador que solo necesite el arreglo de filas.
 */
export async function parsearPlantillaEmpleadosConAdvertencias(
  buffer: Buffer,
): Promise<ResultadoParseoEmpleados> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  // Hoja principal: "Empleados" (plantilla y exportación actuales), o "Personal" (exportaciones anteriores); luego, por compatibilidad,
  // cualquier hoja cuyo nombre lo sugiera y, por último, la primera.
  const ws = wb.getWorksheet(HOJA_EMPLEADOS)
    ?? wb.getWorksheet(HOJA_EMPLEADOS_LEGADO)
    ?? wb.worksheets.find((s) => /empleado|personal/i.test(s.name))
    ?? wb.worksheets[0];
  if (!ws) throw new Error("El Excel no tiene hojas.");

  const headerMap = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    headerMap.set(cellStr(cell.value).toLowerCase(), col);
  });

  const idx = (...names: string[]) => {
    for (const name of names) {
      const n = name.toLowerCase();
      for (const [k, v] of headerMap) {
        if (k === n || k.replace(/\s+/g, "_") === n) return v;
      }
    }
    for (const name of names) {
      const n = name.toLowerCase();
      for (const [k, v] of headerMap) {
        if (k.includes(n)) return v;
      }
    }
    return -1;
  };

  const iCodigo = idx("codigo");
  const iNombre = idx("nombre");
  const iPrimerNom = idx("primer_nombre", "primer nombre");
  const iPrimerApe = idx("primer_apellido", "primer apellido");
  if (iCodigo < 0 && iNombre < 0 && (iPrimerNom < 0 || iPrimerApe < 0)) {
    throw new Error(
      "Plantilla inválida: faltan columnas codigo/nombre o primer_nombre + primer_apellido.",
    );
  }

  const col = (...names: string[]) => idx(...names);

  const filas: FilaImportEmpleado[] = [];
  const descartadas: FilaDescartadaImportEmpleado[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (i: number) => (i > 0 ? cellStr(row.getCell(i).value) : "");
    const getN = (i: number) => (i > 0 ? cellNum(row.getCell(i).value) : null);

    const codigo =
      get(iCodigo > 0 ? iCodigo : col("dpi")) || get(col("dpi"));
    const primerNombre = get(col("primer_nombre", "primer nombre"));
    const segundoNombre = get(col("segundo_nombre", "segundo nombre"));
    const primerApellido = get(col("primer_apellido", "primer apellido"));
    const segundoApellido = get(col("segundo_apellido", "segundo apellido"));
    const apellidoCasada = get(col("apellido_casada", "apellido casada"));
    const nombre =
      get(iNombre > 0 ? iNombre : -1) ||
      [primerNombre, segundoNombre, primerApellido, segundoApellido]
        .filter(Boolean)
        .join(" ");

    // Fila realmente vacía (p.ej. separador en blanco): se ignora sin
    // generar advertencia — no es una fila real de un empleado.
    if (!codigo && !nombre) return;

    if (!codigo) {
      descartadas.push({
        filaExcel: rowNumber,
        codigo: "",
        nombre,
        motivo: "Fila sin código identificador.",
      });
      return;
    }

    if (!nombre) {
      descartadas.push({
        filaExcel: rowNumber,
        codigo,
        nombre: "",
        motivo: "Fila sin nombre.",
      });
      return;
    }

    // IMPORT-EMPLEADOS-SEGURA-2 — "ausencia de columna != valor
    // default": se registra ANTES de aplicar el `|| default`, porque una
    // vez aplicado ya no se puede distinguir "el Excel decía X" de "el
    // Excel no traía esta columna". camposConDefault es lo único que
    // fusionarEmpleadoImport() usa para decidir si preservar el valor
    // actual de un empleado existente en vez de este default.
    const camposConDefault = new Set<CampoConDefaultImport>();

    const horarioCelda = get(col("tipo_horario", "horario"));
    if (!horarioCelda) camposConDefault.add("tipoHorario");
    const horarioRaw = horarioCelda || "Fijo";

    const estadoCelda = get(col("estado_laboral", "estado"));
    if (!estadoCelda) camposConDefault.add("estado");
    const estadoRaw = estadoCelda || "Activo";

    const tipoContratoCelda = get(col("tipo_contrato", "tipo contrato"));
    if (!tipoContratoCelda) camposConDefault.add("tipoContrato");

    const formaPagoCelda = get(col("forma_pago", "forma pago"));
    if (!formaPagoCelda) camposConDefault.add("formaPago");

    const horaEntradaCelda = get(
      col("hora_entrada_teorica", "hora_entrada", "hora entrada"),
    );
    if (!horaEntradaCelda) camposConDefault.add("horaEntradaTeorica");

    const horaSalidaCelda = get(
      col("hora_salida_teorica", "hora_salida", "hora salida"),
    );
    if (!horaSalidaCelda) camposConDefault.add("horaSalidaTeorica");

    filas.push({
      filaExcel: rowNumber,
      codigo,
      nombre,
      dpi: get(col("dpi")) || codigo,
      dpiDesdeCodigo: !get(col("dpi")),
      primerNombre,
      segundoNombre,
      primerApellido,
      segundoApellido,
      apellidoCasada,
      nit: get(col("nit")),
      igss: get(col("igss")),
      irtra: get(col("irtra")),
      sexo: get(col("sexo")),
      fechaNacimiento: get(col("fecha_nacimiento", "fecha nacimiento")),
      puesto: get(col("puesto")),
      categoriaOps: get(col("area", "categoria_ops", "categoría")),
      tipoHorario: /variable/i.test(horarioRaw) ? "Variable" : "Fijo",
      tipoContrato: tipoContratoCelda || "fijo",
      formaPago: formaPagoCelda || "transferencia",
      profesion: get(col("profesion", "profesión")),
      fechaAlta:
        get(col("fecha_contratacion", "fecha contratacion", "fecha_alta")) ||
        get(col("fecha_ingreso", "fecha ingreso")),
      fechaInicioLaboral:
        get(col("fecha_ingreso", "fecha ingreso")) || null,
      horaEntradaTeorica: horaEntradaCelda || "07:00",
      horaSalidaTeorica: horaSalidaCelda || "16:00",
      estado: /baja|inactivo/i.test(estadoRaw) ? "Baja" : "Activo",
      sueldoBase: getN(col("sueldo_base", "sueldo")),
      bonoIncentivo: getN(col("bono_incentivo", "bono incentivo")),
      bonoHerramientas: getN(col("bono_herramientas", "bono herramientas")),
      telefono: get(col("telefono", "teléfono")),
      email: get(col("email", "correo")),
      direccion: get(col("direccion", "dirección")),
      paisOrigen: get(col("pais_origen", "pais origen", "país")),
      municipio: get(col("municipio")),
      etnia: get(col("etnia")),
      religion: get(col("religion", "religión")),
      idioma: get(col("idioma")),
      licenciaNumero: get(col("licencia_numero", "licencia")),
      licenciaTipo: get(col("licencia_tipo")),
      licenciaVence: get(col("licencia_vence")),
      cuentaBancaria: get(col("cuenta_bancaria", "cuenta")),
      tipoCuenta: get(col("tipo_cuenta")),
      banco: get(col("banco")),
      contactoEmergencia: get(col("contacto_emergencia", "emergencia")),
      observaciones: get(col("observaciones", "notas")),
      camposConDefault,
    });
  });
  return { filas, descartadas };
}

/**
 * Compatibilidad: mismo comportamiento exacto de antes de
 * IMPORT-EMPLEADOS-SEGURA-2 (filas sin código/nombre se descartan en
 * silencio). Único consumidor real hoy es el importador de empleados,
 * que ya usa parsearPlantillaEmpleadosConAdvertencias() para conocer
 * también las filas descartadas — esta función se mantiene por si
 * existiera algún otro llamador que solo necesite el arreglo de filas.
 */
export async function parsearPlantillaEmpleados(
  buffer: Buffer,
): Promise<FilaImportEmpleado[]> {
  const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);
  return filas;
}

import ExcelJS from "exceljs";
import type { Empleado } from "./empleados";
import { formatearFechaVisible } from "./dates";
import { tablaAPdf } from "@/lib/rrhh/export-files";
import { CATEGORIAS_OPS, PUESTOS_MONACO } from "./categorias-ops";

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

const EJEMPLO: string[] = [
  "DPI001",
  "DPI001",
  "Juan",
  "Carlos",
  "Pérez",
  "López",
  "",
  "Juan Carlos Pérez López",
  "1234567-8",
  "1234567890",
  "IRTRA01",
  "M",
  "15/03/1990",
  "Piloto",
  "Transporte",
  "Fijo",
  "fijo",
  "transferencia",
  "Piloto",
  "01/01/2024",
  "01/01/2024",
  "07:00",
  "16:00",
  "Activo",
  "3500",
  "250",
  "0",
  "5555-1234",
  "correo@ejemplo.com",
  "Ciudad de Guatemala",
  "Guatemala",
  "Guatemala",
  "Ladino",
  "",
  "Español",
  "",
  "",
  "",
  "",
  "monetaria",
  "",
  "",
  "",
];

export async function generarPlantillaEmpleados(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.addRow([...HEADERS_EMPLEADOS]);
  ws.getRow(1).font = { bold: true };
  ws.addRow(EJEMPLO);

  const help = wb.addWorksheet("Catalogos");
  help.addRow(["area", "puesto", "notas"]);
  help.getRow(1).font = { bold: true };
  const max = Math.max(CATEGORIAS_OPS.length, PUESTOS_MONACO.length);
  for (let i = 0; i < max; i++) {
    help.addRow([
      CATEGORIAS_OPS[i] ?? "",
      PUESTOS_MONACO[i] ?? "",
      i === 0
        ? "codigo = DPI. Área = organigrama. Puesto = cargo (Piloto/Auxiliar…)."
        : "",
    ]);
  }
  help.addRow([]);
  help.addRow([
    "Sexo: M / F",
    "tipo_contrato: fijo / prueba / temporal / outsourcing",
    "forma_pago: transferencia / efectivo / cheque",
  ]);
  help.addRow([
    "Fechas: DD/MM/AAAA",
    "Horas: HH:MM",
    "estado_laboral: Activo / Baja",
  ]);

  ws.columns = HEADERS_EMPLEADOS.map(() => ({ width: 16 }));
  help.columns = [{ width: 22 }, { width: 28 }, { width: 55 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportarEmpleadosExcel(
  empleados: Empleado[],
  empresaNombre: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Personal");
  ws.addRow([...HEADERS_EMPLEADOS]);
  ws.getRow(1).font = { bold: true };
  for (const e of empleados) {
    ws.addRow([
      e.codigo,
      e.dpi ?? "",
      e.primerNombre ?? "",
      e.segundoNombre ?? "",
      e.primerApellido ?? "",
      e.segundoApellido ?? "",
      e.apellidoCasada ?? "",
      e.nombre,
      e.nit ?? "",
      e.igss ?? "",
      e.irtra ?? "",
      e.sexo ?? "",
      formatearFechaVisible(e.fechaNacimiento),
      e.puesto ?? "",
      e.categoriaOps ?? "",
      e.tipoHorario,
      e.tipoContrato ?? "",
      e.formaPago ?? "",
      e.profesion ?? "",
      formatearFechaVisible(e.fechaAlta),
      formatearFechaVisible(e.fechaInicioLaboral),
      e.horaEntradaTeorica,
      e.horaSalidaTeorica,
      e.estado,
      e.sueldoBase != null ? String(e.sueldoBase) : "",
      e.bonoIncentivo != null ? String(e.bonoIncentivo) : "",
      e.bonoHerramientas != null ? String(e.bonoHerramientas) : "",
      e.telefono ?? "",
      e.email ?? "",
      e.direccion ?? "",
      e.paisOrigen ?? "",
      e.municipio ?? "",
      e.etnia ?? "",
      e.religion ?? "",
      e.idioma ?? "",
      e.licenciaNumero ?? "",
      e.licenciaTipo ?? "",
      formatearFechaVisible(e.licenciaVence),
      e.cuentaBancaria ?? "",
      e.tipoCuenta ?? "",
      e.banco ?? "",
      e.contactoEmergencia ?? "",
      e.observaciones ?? "",
    ]);
  }
  ws.columns.forEach((c) => {
    c.width = 14;
  });
  void empresaNombre;
  return Buffer.from(await wb.xlsx.writeBuffer());
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
  const ws = wb.worksheets.find((s) => /empleado|personal/i.test(s.name))
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

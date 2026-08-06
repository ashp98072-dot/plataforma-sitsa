import ExcelJS from "exceljs";
import type { Empleado } from "./empleados";
import { formatearFechaVisible } from "./dates";
import { tablaAPdf } from "@/lib/rrhh/export-files";
import { CATEGORIAS_OPS, PUESTOS_MONACO } from "./categorias-ops";

const HEADERS = [
  "codigo",
  "nombre",
  "dpi",
  "puesto",
  "area",
  "tipo_horario",
  "fecha_ingreso",
  "fecha_contratacion",
  "hora_entrada_teorica",
  "hora_salida_teorica",
  "estado_laboral",
] as const;

export async function generarPlantillaEmpleados(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.addRow([...HEADERS]);
  ws.getRow(1).font = { bold: true };
  ws.addRow([
    "DPI001",
    "Ejemplo Nombre",
    "DPI001",
    "Piloto",
    "Transporte",
    "Fijo",
    "01/01/2024",
    "01/01/2024",
    "07:00",
    "16:00",
    "Activo",
  ]);
  // Hoja de ayuda: áreas y puestos Monaco
  const help = wb.addWorksheet("Catalogos");
  help.addRow(["area", "puesto"]);
  help.getRow(1).font = { bold: true };
  const max = Math.max(CATEGORIAS_OPS.length, PUESTOS_MONACO.length);
  for (let i = 0; i < max; i++) {
    help.addRow([CATEGORIAS_OPS[i] ?? "", PUESTOS_MONACO[i] ?? ""]);
  }
  ws.columns = HEADERS.map(() => ({ width: 18 }));
  help.columns = [{ width: 22 }, { width: 28 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportarEmpleadosExcel(
  empleados: Empleado[],
  empresaNombre: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Personal");
  ws.addRow([
    "Código",
    "Nombre",
      "Puesto",
      "Área",
      "Horario",
    "Fecha contratación",
    "Fecha entrada laboral",
    "Entrada",
    "Salida",
    "Estado",
  ]);
  ws.getRow(1).font = { bold: true };
  for (const e of empleados) {
    ws.addRow([
      e.codigo,
      e.nombre,
      e.puesto ?? "",
      e.categoriaOps ?? "",
      e.tipoHorario,
      formatearFechaVisible(e.fechaAlta),
      formatearFechaVisible(e.fechaInicioLaboral),
      e.horaEntradaTeorica,
      e.horaSalidaTeorica,
      e.estado,
    ]);
  }
  ws.columns.forEach((c) => {
    c.width = 16;
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
      "Horario",
      "Estado",
      "Contrato",
      "Entrada lab.",
    ],
    rows: empleados.map((e) => [
      e.codigo,
      e.nombre,
      e.puesto || "—",
      e.tipoHorario,
      e.estado,
      formatearFechaVisible(e.fechaAlta) || "—",
      formatearFechaVisible(e.fechaInicioLaboral) || "—",
    ]),
    modo: "tabla",
    layout: "landscape",
  });
}

export type FilaImportEmpleado = {
  codigo: string;
  nombre: string;
  dpi: string;
  puesto: string;
  categoriaOps: string;
  tipoHorario: "Fijo" | "Variable";
  fechaAlta: string;
  fechaInicioLaboral: string | null;
  horaEntradaTeorica: string;
  horaSalidaTeorica: string;
  estado: "Activo" | "Baja";
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

export async function parsearPlantillaEmpleados(
  buffer: Buffer,
): Promise<FilaImportEmpleado[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("El Excel no tiene hojas.");

  const headerMap = new Map<string, number>();
  ws.getRow(1).eachCell((cell, col) => {
    headerMap.set(cellStr(cell.value).toLowerCase(), col);
  });

  const idx = (name: string) => {
    for (const [k, v] of headerMap) {
      if (k === name || k.includes(name)) return v;
    }
    return -1;
  };

  const iCodigo = idx("codigo");
  const iNombre = idx("nombre");
  if (iCodigo < 0 || iNombre < 0) {
    throw new Error("Plantilla inválida: faltan columnas codigo y nombre.");
  }

  const iPuesto = idx("puesto");
  const iArea = idx("area");
  const iDpi = idx("dpi");
  const iHorario = idx("tipo_horario");
  const iIngreso = idx("fecha_ingreso");
  const iContra = idx("fecha_contratacion");
  const iEnt = idx("hora_entrada");
  const iSal = idx("hora_salida");
  const iEstado = idx("estado");

  const filas: FilaImportEmpleado[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const codigo = cellStr(row.getCell(iCodigo).value);
    const nombre = cellStr(row.getCell(iNombre).value);
    if (!codigo || !nombre) return;
    const horarioRaw =
      iHorario > 0 ? cellStr(row.getCell(iHorario).value) : "Fijo";
    const estadoRaw =
      iEstado > 0 ? cellStr(row.getCell(iEstado).value) : "Activo";
    const dpi = iDpi > 0 ? cellStr(row.getCell(iDpi).value) : "";
    filas.push({
      codigo,
      nombre,
      dpi: dpi || codigo,
      puesto: iPuesto > 0 ? cellStr(row.getCell(iPuesto).value) : "",
      categoriaOps: iArea > 0 ? cellStr(row.getCell(iArea).value) : "",
      tipoHorario: /variable/i.test(horarioRaw) ? "Variable" : "Fijo",
      fechaAlta:
        iContra > 0
          ? cellStr(row.getCell(iContra).value)
          : iIngreso > 0
            ? cellStr(row.getCell(iIngreso).value)
            : "",
      fechaInicioLaboral:
        iIngreso > 0 ? cellStr(row.getCell(iIngreso).value) || null : null,
      horaEntradaTeorica:
        iEnt > 0 ? cellStr(row.getCell(iEnt).value) || "07:00" : "07:00",
      horaSalidaTeorica:
        iSal > 0 ? cellStr(row.getCell(iSal).value) || "16:00" : "16:00",
      estado: /baja|inactivo/i.test(estadoRaw) ? "Baja" : "Activo",
    });
  });
  return filas;
}

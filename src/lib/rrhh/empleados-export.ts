import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { Empleado } from "./empleados";
import { formatearFechaVisible } from "./dates";

const HEADERS = [
  "codigo",
  "nombre",
  "puesto",
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
    "Operador",
    "Fijo",
    "01/01/2024",
    "01/01/2024",
    "08:00",
    "17:00",
    "Activo",
  ]);
  ws.columns = HEADERS.map(() => ({ width: 18 }));
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
    "Cat. ops",
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
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc
      .fontSize(14)
      .text(`SITSA — Empleados · ${empresaNombre}`, { align: "left" });
    doc.moveDown(0.4);
    doc.fontSize(9).fillColor("#444").text(`Total: ${empleados.length}`);
    doc.moveDown();

    const colX = [40, 110, 250, 340, 400, 460];
    let y = doc.y;
    doc.fillColor("#000").fontSize(8).font("Helvetica-Bold");
    doc.text("Código", colX[0], y);
    doc.text("Nombre", colX[1], y);
    doc.text("Puesto", colX[2], y);
    doc.text("Horario", colX[3], y);
    doc.text("Estado", colX[4], y);
    doc.text("Contrato", colX[5], y);
    y += 14;
    doc.moveTo(40, y).lineTo(570, y).stroke();
    y += 6;

    doc.font("Helvetica").fontSize(8);
    for (const e of empleados) {
      if (y > 740) {
        doc.addPage();
        y = 40;
      }
      doc.text(e.codigo, colX[0], y, { width: 65, ellipsis: true });
      doc.text(e.nombre, colX[1], y, { width: 130, ellipsis: true });
      doc.text(e.puesto || "—", colX[2], y, { width: 80, ellipsis: true });
      doc.text(e.tipoHorario, colX[3], y, { width: 55 });
      doc.text(e.estado, colX[4], y, { width: 50 });
      doc.text(formatearFechaVisible(e.fechaAlta) || "—", colX[5], y, {
        width: 70,
      });
      y += 12;
    }
    doc.end();
  });
}

export type FilaImportEmpleado = {
  codigo: string;
  nombre: string;
  puesto: string;
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
    filas.push({
      codigo,
      nombre,
      puesto: iPuesto > 0 ? cellStr(row.getCell(iPuesto).value) : "",
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
        iEnt > 0 ? cellStr(row.getCell(iEnt).value) || "08:00" : "08:00",
      horaSalidaTeorica:
        iSal > 0 ? cellStr(row.getCell(iSal).value) || "17:00" : "17:00",
      estado: /baja/i.test(estadoRaw) ? "Baja" : "Activo",
    });
  });
  return filas;
}

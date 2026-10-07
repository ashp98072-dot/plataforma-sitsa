import ExcelJS from "exceljs";
import { COLUMNAS_EXPORT, type ResultadoExport } from "./vacaciones-historial-export";

/**
 * XLSX del historial actual de vacaciones, EN MEMORIA (no escribe nada en disco ni en la base).
 *
 *  - Hoja 1 «Historial»: exactamente las columnas del importador (lectura de la PRIMERA hoja). Fechas como texto ISO «YYYY-MM-DD»
 *    (sin seriales ni zona horaria: son exactas al reimportar); códigos, DPI y nombres como texto; días como número.
 *  - Hoja 2 «Problemas»: el reporte administrativo (vacaciones sin pareja, tipo ambiguo, …). El importador ignora esta hoja.
 */
export async function construirXlsxHistorial(resultado: ResultadoExport): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = "Plataforma SITSA";
  const hoja = libro.addWorksheet("Historial");
  hoja.addRow([...COLUMNAS_EXPORT]);
  for (const f of resultado.filas) {
    hoja.addRow([f.codigo, f.dpi, f.nombre, f.fecha_inicio, f.fecha_fin, f.dias_habiles, f.tipo, f.observacion]);
  }
  for (const c of [1, 2, 3, 4, 5, 7, 8]) hoja.getColumn(c).numFmt = "@"; // texto
  [14, 16, 36, 13, 13, 13, 24, 40].forEach((w, i) => { hoja.getColumn(i + 1).width = w; });
  hoja.getRow(1).font = { bold: true };
  hoja.views = [{ state: "frozen", ySplit: 1 }];

  const probl = libro.addWorksheet("Problemas");
  probl.addRow(["severidad", "codigo", "empleado", "mensaje", "vacaciones_ids", "incidencias_ids"]);
  for (const p of resultado.problemas) {
    probl.addRow([p.severidad, p.codigo, p.empleado ?? "", p.mensaje, (p.vacacionIds ?? []).join(", "), (p.incidenciaIds ?? []).join(", ")]);
  }
  probl.getRow(1).font = { bold: true };
  [12, 32, 30, 110, 16, 16].forEach((w, i) => { probl.getColumn(i + 1).width = w; });

  return Buffer.from(await libro.xlsx.writeBuffer());
}

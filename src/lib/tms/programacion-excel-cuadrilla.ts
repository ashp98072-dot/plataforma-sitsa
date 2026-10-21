import ExcelJS from "exceljs";
import { envolverTexto } from "./programacion-imagen";

/** Ajuste local: conserva el generador compartido y todas las demás columnas.
 * Excel limita la altura de fila a 409.5 puntos: se usan continuaciones solo
 * cuando la celda de Cuadrilla superaría ese límite, nunca se truncan nombres.
 */
export async function formatearCuadrillaExcel(buffer: Buffer): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return buffer;
  let columna = 0;
  ws.getRow(1).eachCell((celda, i) => { if (celda.value === "Cuadrilla") columna = i; });
  if (!columna) return buffer;
  const ancho = ws.getColumn(columna).width ?? 42;
  // Presupuesto conservador para Calibri 11: dos unidades por carácter ancho.
  const caracteres = Math.max(1, Math.floor((ancho - 2) / 2));
  for (let i = ws.rowCount; i >= 2; i--) {
    const fila = ws.getRow(i);
    const celda = fila.getCell(columna);
    if (!celda.value) continue;
    const lineas = envolverTexto(String(celda.value), caracteres, (texto) => Array.from(texto).length, true);
    const grupos: string[][] = [];
    for (let j = 0; j < lineas.length; j += 24) grupos.push(lineas.slice(j, j + 24));
    grupos.forEach((grupo, j) => {
      const destino = j === 0 ? fila : ws.insertRow(i + j, []);
      const c = destino.getCell(columna);
      c.value = grupo.join("\n");
      c.alignment = { ...celda.alignment, wrapText: true, vertical: "top" };
      c.font = celda.font;
      destino.height = Math.max(destino.height ?? 15, grupo.length * 16 + 4);
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

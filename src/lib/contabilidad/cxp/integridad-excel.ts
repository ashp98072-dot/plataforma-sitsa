import ExcelJS from "exceljs";
import { valorCeldaImporte } from "./antiguedad-shared";
import { CODIGOS_SOLO_PAGOS, LIMITE_EXPORTACION_INTEGRIDAD, NOTA_EXPORTACION_INTEGRIDAD, ROTULO_INTEGRIDAD, type ExportacionIntegridad } from "./integridad-shared";

export const COLUMNAS_INTEGRIDAD_EXCEL = ["Entidad", "Factura ID", "Documento", "Proveedor ID", "Proveedor", "Estado administrativo", "Monto pagadero", "Pagado vigente", "Exceso aplicado", "Código de advertencia", "Descripción de la anomalía"];
export const COLUMNAS_PAGO_INTEGRIDAD = ["Pago ID", "Estado del pago (reversado no suma al vigente)", "Total del pago", "Suma de aplicaciones", "Monto de la aplicación"];

/** Celdas de texto explícitas; prefijo neutralizador aun si se copian luego a otro formato. Nunca objetos fórmula/hipervínculo. */
export function textoSeguroIntegridad(v: string): string {
  return /^[\s\u0000-\u001f\u007f\ufeff]*[=+\-@]/u.test(v) ? `'${v}` : v;
}
const texto = (v: string | null) => v === null ? "" : textoSeguroIntegridad(v);
const money = (v: string | null) => v === null ? "" : valorCeldaImporte(v);
const formato = (r: ExcelJS.Row, cols: number[]) => { for (const c of cols) if (typeof r.getCell(c).value === "number") r.getCell(c).numFmt = "#,##0.00"; };

export async function integridadAExcel(d: ExportacionIntegridad): Promise<Buffer> {
  // Defensa contra libros incompletos o mezclados. El servicio aplica además el límite antes de cargar filas.
  if (d.filas.length !== d.totalAdvertencias || d.filas.length > LIMITE_EXPORTACION_INTEGRIDAD) throw new Error("Conjunto de exportación incompleto o excesivo");
  if (d.filas.some(f => f.entidadId !== d.entidadId || (!d.pagosVisibles && CODIGOS_SOLO_PAGOS.includes(f.advertencia.codigo)))) throw new Error("Conjunto de exportación no autorizado");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Novalvion";
  wb.created = new Date(d.generadoEn);
  const ws = wb.addWorksheet("Integridad CxP");
  ws.addRow([ROTULO_INTEGRIDAD]);
  ws.addRow([NOTA_EXPORTACION_INTEGRIDAD]);
  const columnas = [...COLUMNAS_INTEGRIDAD_EXCEL, ...(d.pagosVisibles ? COLUMNAS_PAGO_INTEGRIDAD : [])];
  ws.addRow(columnas).font = { bold: true };
  for (const f of d.filas) {
    const a = f.advertencia;
    // No se serializa `detalle` ni un objeto arbitrario: sólo columnas y mensajes de categorías permitidas.
    const cells: (number | string)[] = [f.entidadId, f.facturaId ?? "", texto(f.documento), f.proveedorId, texto(f.proveedor), texto(f.estadoAdmin),
      money(f.montoPagadero), money(f.pagado), money(f.excesoAplicado), texto(a.codigo), texto(a.mensaje)];
    if (d.pagosVisibles) cells.push(f.pago?.id ?? "", texto(f.pago?.estado ?? null), money(f.pago?.montoTotal ?? null), money(f.pago?.sumaAplicaciones ?? null), money(f.pago?.montoAplicado ?? null));
    formato(ws.addRow(cells), d.pagosVisibles ? [7,8,9,14,15,16] : [7,8,9]);
  }
  ws.columns = columnas.map((h,i) => ({ width: i === 10 ? 85 : Math.min(44,Math.max(14,h.length + 2)) }));
  ws.views = [{ state: "frozen", ySplit: 3 }];
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: Math.max(3,ws.rowCount), column: columnas.length } };

  const resumen = wb.addWorksheet("Resumen");
  resumen.addRow(["Integridad CxP — conjunto filtrado completo"]).font = { bold: true };
  resumen.addRow(["Entidad revisada",d.entidadId]);
  resumen.addRow(["Proveedor (filtro)",d.filtros.proveedorId ?? "Todos"]);
  resumen.addRow(["Código (filtro)",texto(d.filtros.codigo ?? "Todos los autorizados")]);
  resumen.addRow(["Estado administrativo (filtro)",texto(d.filtros.estado ?? "Todos")]);
  resumen.addRow(["Facturas en el ámbito",d.facturasEnAmbito]);
  resumen.addRow(["Facturas revisadas",d.facturasRevisadas]);
  resumen.addRow(["Facturas con anomalías identificadas",d.facturasConAnomalias]);
  resumen.addRow(["Total de advertencias",d.totalAdvertencias]);
  for (const [codigo,n] of Object.entries(d.porCodigo)) {
    if (!d.pagosVisibles && CODIGOS_SOLO_PAGOS.includes(codigo as typeof CODIGOS_SOLO_PAGOS[number])) throw new Error("Contador de pago no autorizado");
    resumen.addRow([textoSeguroIntegridad(codigo),n]);
  }
  resumen.addRow(["Fecha y hora de generación (UTC)",texto(d.generadoEn)]);
  resumen.addRow([NOTA_EXPORTACION_INTEGRIDAD]);
  for (const limitacion of d.limitaciones) resumen.addRow(["Limitación de evaluación",texto(limitacion)]);
  resumen.columns = [{ width: 70 },{ width: 110 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

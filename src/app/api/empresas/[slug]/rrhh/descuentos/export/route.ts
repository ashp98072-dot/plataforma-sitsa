import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  CLASIFICACIONES,
  ESTADOS_DESCUENTO,
  listarCuotasDeDescuentos,
  listarDescuentos,
  type Clasificacion,
  type EstadoDescuento,
} from "@/lib/rrhh/descuentos";

type Ctx = { params: Promise<{ slug: string }> };

const fechaValida = /^\d{4}-\d{2}-\d{2}$/;
const moneda = '"Q"#,##0.00';
const azul = "1F4E78";
const celeste = "D9EAF7";
const amarillo = "FFF2CC";

function filtrosDe(req: Request) {
  const p = new URL(req.url).searchParams;
  const estado = p.get("estado");
  const clasificacion = p.get("clasificacion");
  const empleadoId = Number(p.get("empleadoId"));
  const fechaDesde = p.get("fechaDesde");
  const fechaHasta = p.get("fechaHasta");
  return {
    empleadoId: Number.isInteger(empleadoId) && empleadoId > 0 ? empleadoId : undefined,
    estado:
      estado && (ESTADOS_DESCUENTO as readonly string[]).includes(estado)
        ? (estado as EstadoDescuento)
        : undefined,
    clasificacion:
      clasificacion && (CLASIFICACIONES as readonly string[]).includes(clasificacion)
        ? (clasificacion as Clasificacion)
        : undefined,
    concepto: p.get("concepto")?.trim() || undefined,
    fechaDesde: fechaDesde && fechaValida.test(fechaDesde) ? fechaDesde : undefined,
    fechaHasta: fechaHasta && fechaValida.test(fechaHasta) ? fechaHasta : undefined,
  };
}

function encabezado(ws: ExcelJS.Worksheet, fila: number) {
  const row = ws.getRow(fila);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${azul}` } };
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 30;
}

function ajustar(ws: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((width, i) => { ws.getColumn(i + 1).width = width; });
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "ver");
  if (guard.error) return guard.error;

  const filtros = filtrosDe(req);
  const descuentos = await listarDescuentos(guard.empresa.id, filtros);
  const cuotas = await listarCuotasDeDescuentos(
    guard.empresa.id,
    descuentos.map((d) => d.id),
  );
  const descuentoPorId = new Map(descuentos.map((d) => [d.id, d]));

  const wb = new ExcelJS.Workbook();
  wb.creator = "SITSA Plataforma";
  wb.created = new Date();

  const resumen = wb.addWorksheet("RESUMEN");
  resumen.addRow([`CONTROL DE DESCUENTOS — ${guard.empresa.nombre}`]);
  resumen.mergeCells("A1:D1");
  resumen.getRow(1).font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  resumen.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${azul}` } };
  resumen.addRow(["Generado", new Date().toLocaleString("es-GT"), "Registros", descuentos.length]);
  resumen.addRow(["Desde", filtros.fechaDesde ?? "Todos", "Hasta", filtros.fechaHasta ?? "Todos"]);
  resumen.addRow([]);
  resumen.addRow(["Total original", "Total descontado", "Saldo pendiente", "Cuotas aplicadas"]);
  encabezado(resumen, 5);
  resumen.addRow([
    descuentos.reduce((s, d) => s + d.montoOriginal, 0),
    descuentos.reduce((s, d) => s + d.pagado, 0),
    descuentos.reduce((s, d) => s + d.saldo, 0),
    descuentos.reduce((s, d) => s + d.cuotasAplicadas, 0),
  ]);
  resumen.getRow(6).eachCell((cell, col) => { if (col <= 3) cell.numFmt = moneda; });
  resumen.addRow([]);
  resumen.addRow(["Quincena", "Mes", "Año", "Total programado", "Total aplicado"]);
  encabezado(resumen, 8);
  const porQuincena = new Map<string, { quincena: string; mes: string; anio: number; programado: number; aplicado: number }>();
  for (const cuota of cuotas) {
    const [anio, mes, dia] = cuota.fechaProgramada.split("-").map(Number);
    if (!anio || !mes || !dia) continue;
    const quincena = dia <= 15 ? "Primera quincena" : "Segunda quincena";
    const clave = `${anio}-${String(mes).padStart(2, "0")}-${dia <= 15 ? "01" : "02"}`;
    const actual = porQuincena.get(clave) ?? {
      quincena,
      mes: new Intl.DateTimeFormat("es-GT", { month: "long", timeZone: "UTC" }).format(
        new Date(Date.UTC(anio, mes - 1, 1)),
      ),
      anio,
      programado: 0,
      aplicado: 0,
    };
    actual.programado += cuota.montoProgramado;
    actual.aplicado += cuota.montoAplicado ?? 0;
    porQuincena.set(clave, actual);
  }
  for (const [, periodo] of [...porQuincena].sort(([a], [b]) => a.localeCompare(b))) {
    resumen.addRow([
      periodo.quincena,
      periodo.mes,
      periodo.anio,
      periodo.programado,
      periodo.aplicado,
    ]);
  }
  [4, 5].forEach((col) => { resumen.getColumn(col).numFmt = moneda; });
  resumen.columns.forEach((c) => { c.width = 24; });

  const detalle = wb.addWorksheet("DESCUENTOS");
  detalle.addRow([
    "Código", "Colaborador", "DPI", "Puesto", "Concepto", "Motivo / por qué",
    "Clasificación", "Total descuento", "Lleva abonado", "Falta por abonar",
    "Número de cuotas", "Cuotas aplicadas", "Periodicidad", "Fecha de inicio", "Estado",
  ]);
  encabezado(detalle, 1);
  for (const d of descuentos) {
    detalle.addRow([
      d.codigo, d.empleadoNombre, d.empleadoDpi, d.empleadoPuesto, d.concepto,
      d.motivo || "Sin motivo registrado", d.clasificacion, d.montoOriginal, d.pagado,
      d.saldo, d.numeroCuotas, d.cuotasAplicadas, d.periodicidad, d.fechaInicio, d.estado,
    ]);
  }
  [8, 9, 10].forEach((col) => { detalle.getColumn(col).numFmt = moneda; });
  detalle.eachRow((row, number) => {
    if (number > 1) {
      row.alignment = { vertical: "top", wrapText: true };
      if (number % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${celeste}` } };
    }
  });
  ajustar(detalle, [18, 30, 18, 24, 24, 38, 16, 17, 17, 17, 15, 16, 22, 16, 14]);

  const proyeccion = wb.addWorksheet("CUOTAS");
  proyeccion.addRow([
    "Código descuento", "Colaborador", "DPI", "Concepto", "Motivo / observaciones",
    "Cuota", "Fecha programada", "Monto programado", "Monto aplicado", "Estado cuota",
    "Estado descuento", "Planilla periodo ID", "Motivo de ajuste",
  ]);
  encabezado(proyeccion, 1);
  for (const c of cuotas) {
    const d = descuentoPorId.get(c.descuentoId);
    if (!d) continue;
    proyeccion.addRow([
      d.codigo, d.empleadoNombre, d.empleadoDpi, d.concepto,
      d.motivo || "Sin motivo registrado", c.numeroCuota, c.fechaProgramada,
      c.montoProgramado, c.montoAplicado, c.estado, d.estado,
      c.planillaPeriodoId, c.motivoAjuste ?? "",
    ]);
  }
  [8, 9].forEach((col) => { proyeccion.getColumn(col).numFmt = moneda; });
  proyeccion.eachRow((row, number) => {
    if (number > 1) {
      row.alignment = { vertical: "top", wrapText: true };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${amarillo}` } };
    }
  });
  ajustar(proyeccion, [20, 30, 18, 24, 38, 10, 18, 18, 18, 16, 18, 18, 30]);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="control-descuentos-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}

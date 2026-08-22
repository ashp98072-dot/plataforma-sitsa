import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  calcularCuadre,
  listarLineas,
  obtenerPeriodo,
} from "@/lib/rrhh/planillas";
import {
  etiquetaFormaPago,
  etiquetaTipoContrato,
} from "@/lib/rrhh/contratos-pago";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "ver");
  if (guard.error) return guard.error;
  const periodoId = Number(id);
  if (!Number.isFinite(periodoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const periodo = await obtenerPeriodo(guard.empresa.id, periodoId);
  if (!periodo) {
    return NextResponse.json({ error: "Periodo no encontrado." }, { status: 404 });
  }
  const lineas = await listarLineas(guard.empresa.id, periodoId);
  const cuadre = calcularCuadre(lineas);

  const wb = new ExcelJS.Workbook();
  wb.creator = "SITSA Plataforma";
  const ws = wb.addWorksheet("Planilla");
  ws.addRow([
    "Empresa",
    guard.empresa.nombre,
    "Periodo",
    periodo.codigo,
    `${periodo.fechaInicio} → ${periodo.fechaFin}`,
    periodo.estado,
  ]);
  ws.addRow([]);
  ws.addRow([
    "Código",
    "Nombre",
    "DPI",
    "Tipo contrato",
    "Forma pago",
    "Sueldo base",
    "Bono incentivo",
    "Bono herramientas",
    "Otros ingresos",
    "IGSS laboral 4.83%",
    "IGSS patronal 12.67%",
    "Descuentos",
    "ISR",
    "Neto a pagar",
    "Estado pago",
    "Ref. pago",
  ]);
  ws.getRow(3).font = { bold: true };
  for (const l of lineas) {
    ws.addRow([
      l.codigoEmpleado,
      l.nombreEmpleado,
      l.dpi,
      etiquetaTipoContrato(l.tipoContrato),
      etiquetaFormaPago(l.formaPago),
      l.sueldoBase,
      l.bonoIncentivo,
      l.bonoHerramientas,
      l.otrosIngresos,
      l.igssLaboral,
      l.igssPatronal,
      l.descuentos,
      l.isr,
      l.neto,
      l.estadoPago,
      l.refPago,
    ]);
  }

  const cu = wb.addWorksheet("Cuadre");
  cu.addRow(["Cuadre de nómina — Guatemala (operativo)"]);
  cu.addRow([]);
  cu.addRow(["Forma de pago", "Cantidad", "Neto", "Pagado", "Pendiente"]);
  cu.getRow(3).font = { bold: true };
  for (const forma of ["transferencia", "cheque", "efectivo"] as const) {
    const b = cuadre.porFormaPago[forma];
    cu.addRow([
      etiquetaFormaPago(forma),
      b.cantidad,
      b.neto,
      b.pagado,
      b.pendiente,
    ]);
  }
  cu.addRow([]);
  cu.addRow(["Totales", "", ""]);
  cu.addRow(["Empleados", cuadre.totales.empleados]);
  cu.addRow(["Formales (IGSS)", cuadre.totales.formales]);
  cu.addRow(["Outsourcing", cuadre.totales.outsourcing]);
  cu.addRow(["Sueldos base", cuadre.totales.sueldoBase]);
  cu.addRow(["Bonos", cuadre.totales.bonos]);
  cu.addRow(["Otros ingresos (prestaciones del periodo)", cuadre.totales.otrosIngresos]);
  cu.addRow(["IGSS laboral retenido", cuadre.totales.igssLaboral]);
  cu.addRow(["IGSS patronal (costo empresa)", cuadre.totales.igssPatronal]);
  cu.addRow(["Descuentos", cuadre.totales.descuentos]);
  cu.addRow(["ISR", cuadre.totales.isr]);
  cu.addRow(["Neto a pagar", cuadre.totales.neto]);
  cu.addRow(["Ya pagado", cuadre.totales.pagado]);
  cu.addRow(["Pendiente de pago", cuadre.totales.pendiente]);
  cu.addRow([]);
  cu.addRow([
    "Notas",
    "IGSS laboral 4.83% e IGSS patronal 12.67% sobre sueldo ordinario (sin bono incentivo). Outsourcing no calcula IGSS. ISR se calcula automáticamente (proyección anual SAT) y es ajustable manualmente por línea si hace falta. En periodos de Quincena 1/Quincena 2, sueldo, bonos, IGSS e ISR se reparten entre ambas quincenas del mes. Exportar y cruzar con planilla electrónica IGSS.",
  ]);

  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  const filename = `planilla-${periodo.codigo.replace(/[^\w.-]+/g, "_")}.xlsx`;
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

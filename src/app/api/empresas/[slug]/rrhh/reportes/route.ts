import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { requireTenantModulo } from "@/lib/tenant";
import { obtenerRangoPeriodo } from "@/lib/rrhh/periodos";
import {
  obtenerReporteAsistencias,
  obtenerResumenIncidenciasDetallado,
} from "@/lib/rrhh/reportes";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const periodo = url.searchParams.get("periodo") ?? "";
  let desde = url.searchParams.get("desde") ?? "";
  let hasta = url.searchParams.get("hasta") ?? "";
  if (periodo && periodo !== "Rango personalizado") {
    const rango = await obtenerRangoPeriodo(guard.empresa.id, periodo);
    if (rango) {
      desde = rango.desde;
      hasta = rango.hasta;
    }
  }
  if (!desde || !hasta) {
    const hoy = new Date().toISOString().slice(0, 10);
    desde = desde || hoy;
    hasta = hasta || hoy;
  }

  const tipo = url.searchParams.get("tipo") ?? "Todos";
  const horario = url.searchParams.get("horario") ?? "Todos";
  const modo = url.searchParams.get("modo") ?? "asistencias";
  const formato = url.searchParams.get("formato") ?? "json";

  if (modo === "incidencias") {
    const resumen = await obtenerResumenIncidenciasDetallado(
      guard.empresa.id,
      desde,
      hasta,
    );
    if (formato === "xlsx") {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Incidencias");
      ws.addRow([
        "Código",
        "Empleado",
        "Retrasos",
        "Salidas tempranas",
        "Faltas",
        "Días asistidos",
      ]);
      for (const r of resumen) {
        ws.addRow([
          r.codigo,
          r.empleado,
          r.totalRetrasos,
          r.totalSalidasTempranas,
          r.totalFaltas,
          r.totalDiasAsistidos,
        ]);
      }
      const buf = Buffer.from(await wb.xlsx.writeBuffer());
      return new NextResponse(buf, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="incidencias-${slug}-${desde}-${hasta}.xlsx"`,
        },
      });
    }
    return NextResponse.json({ desde, hasta, resumen });
  }

  const filas = await obtenerReporteAsistencias(
    guard.empresa.id,
    desde,
    hasta,
    { tipo, horario },
  );

  if (formato === "xlsx") {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Asistencias");
    ws.addRow([
      "Fecha",
      "Código",
      "Empleado",
      "Entrada",
      "Salida",
      "Estado entrada",
      "Estado salida",
      "Motivo",
      "Horario",
      "Comentarios",
    ]);
    for (const r of filas) {
      ws.addRow([
        r.fecha,
        r.codigo,
        r.nombre,
        r.horaEntrada ?? "",
        r.horaSalida ?? "",
        r.estadoEntrada,
        r.estadoSalida,
        r.motivo,
        r.tipoHorario,
        r.comentarios,
      ]);
    }
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    return new NextResponse(buf, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="asistencias-${slug}-${desde}-${hasta}.xlsx"`,
      },
    });
  }

  return NextResponse.json({
    desde,
    hasta,
    empresa: guard.empresa.nombre,
    filas,
  });
}

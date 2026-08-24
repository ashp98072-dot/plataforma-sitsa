import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerRangoPeriodo } from "@/lib/rrhh/periodos";
import {
  obtenerReporteAsistencias,
  obtenerResumenIncidenciasDetallado,
} from "@/lib/rrhh/reportes";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "reportes", "ver");
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
  const tituloBase = `${guard.empresa.nombre} · ${desde} → ${hasta}`;

  if (modo === "incidencias") {
    const resumen = await obtenerResumenIncidenciasDetallado(
      guard.empresa.id,
      desde,
      hasta,
    );
    const headers = [
      "Código",
      "Empleado",
      "Retrasos",
      "Salidas tempranas",
      "Faltas",
      "Días asistidos",
    ];
    const rows = resumen.map((r) => [
      r.codigo,
      r.empleado,
      String(r.totalRetrasos),
      String(r.totalSalidasTempranas),
      String(r.totalFaltas),
      String(r.totalDiasAsistidos),
    ]);

    if (formato === "xlsx") {
      const buf = await tablaAExcel({
        sheetName: "Incidencias",
        headers,
        rows,
      });
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="incidencias-${slug}-${desde}-${hasta}.xlsx"`,
        },
      });
    }
    if (formato === "pdf") {
      const buf = await tablaAPdf({
        title: "Resumen de incidencias",
        subtitle: tituloBase,
        headers,
        rows,
      });
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="incidencias-${slug}-${desde}-${hasta}.pdf"`,
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

  const headers = [
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
    "Foto entrada",
    "Foto salida",
  ];
  const rows = filas.map((r) => [
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
    r.fotoEntradaId ? "Disponible en el sistema" : "",
    r.fotoSalidaId ? "Disponible en el sistema" : "",
  ]);

  if (formato === "xlsx") {
    const buf = await tablaAExcel({
      sheetName: "Asistencias",
      headers,
      rows,
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="asistencias-${slug}-${desde}-${hasta}.xlsx"`,
      },
    });
  }

  if (formato === "pdf") {
    const buf = await tablaAPdf({
      title: "Reporte de asistencias",
      subtitle: tituloBase,
      headers,
      rows,
    });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="asistencias-${slug}-${desde}-${hasta}.pdf"`,
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

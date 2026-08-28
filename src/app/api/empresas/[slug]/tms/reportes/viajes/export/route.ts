import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import {
  calcularKpisReporte,
  filtrosReporteDesdeUrl,
  obtenerReporteViajesParaExportar,
  type PlanReporte,
} from "@/lib/tms/reportes-viajes";
import { tablaAExcel, tablaAPdf } from "@/lib/rrhh/export-files";
import { ahoraLocal, formatearTimestampVisible, hoyLocal } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

function moneda(v: number | null): string {
  if (v == null) return "Pendiente";
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * TMS-REPORTES-1 (Fase I/J) — reutiliza los exportadores genéricos ya
 * existentes (tablaAExcel/tablaAPdf, src/lib/rrhh/export-files.ts) en vez
 * de crear un generador nuevo. Columnas base = referencia del Excel real
 * de Operaciones ("REPORTE DE VIAJES...xlsx"), más las columnas
 * adicionales pedidas (código, estado, llegada, km, evidencias,
 * referencia, cierre). "Consumo de combustible" y "Equipo asignado"
 * quedan documentados como limitación de datos — ver reporte del ticket.
 */
function filaExcel(p: PlanReporte): string[] {
  return [
    p.fechaPlan,
    p.cliente ?? "—",
    p.unidadTipo ? `${p.unidadTipo}${p.unidadCapacidad ? ` · ${p.unidadCapacidad}` : ""}` : "—",
    p.placa ?? "—",
    p.tipoTraslado ?? "—",
    p.diasRuta != null ? String(p.diasRuta) : "—",
    p.horaSalida ? p.horaSalida.replace("T", " ") : "—",
    p.kmRecorridos != null ? String(p.kmRecorridos) : "—",
    "—", // Consumo de combustible: sin fuente real por viaje (ver auditoría del ticket)
    p.piloto ?? "—",
    p.auxiliares[0] ?? "—",
    p.auxiliares[1] ?? "—",
    p.tarifaComercial != null ? String(p.tarifaComercial) : "Pendiente",
    // Adicionales
    p.codigo,
    p.estado,
    p.horaLlegada ? p.horaLlegada.replace("T", " ") : "—",
    p.kmSalida != null ? String(p.kmSalida) : "—",
    p.kmLlegada != null ? String(p.kmLlegada) : "—",
    String(p.evidencias),
    p.referenciaCliente ?? "—",
    p.cerradoEn ? p.cerradoEn.replace("T", " ") : "—",
    p.cerradoPor ?? "—",
  ];
}

const HEADERS_EXCEL = [
  "Fecha", "Cliente", "Equipo asignado", "Identificación vehículo", "Tipo viaje",
  "Días ruta", "Hora salida", "Km recorridos", "Consumo combustible",
  "Piloto", "Auxiliar 1", "Auxiliar 2", "Valor del viaje",
  "Código plan", "Estado", "Hora llegada", "Km salida", "Km llegada",
  "Evidencias", "Referencia cliente", "Fecha cierre", "Cerrado por",
];

const HEADERS_PDF = ["Fecha", "Código", "Cliente", "Unidad", "Piloto", "Km", "Evidencias", "Tarifa", "Estado"];
function filaPdf(p: PlanReporte): string[] {
  return [
    p.fechaPlan, p.codigo, p.cliente ?? "—", p.placa ?? "—", p.piloto ?? "—",
    p.kmRecorridos != null ? String(p.kmRecorridos) : "—",
    String(p.evidencias), moneda(p.tarifaComercial), p.estado,
  ];
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") === "pdf" ? "pdf" : "xlsx";
  const filtros = filtrosReporteDesdeUrl(url);

  // CORRECCIÓN PR #112 (HALLAZGO 3): exporta TODO el rango filtrado — ya
  // no el LIMIT 2000 silencioso. Si el volumen excede el máximo seguro
  // sin un filtro que lo acote, se rechaza con un mensaje claro (nunca
  // se trunca sin avisar).
  const resultado = await obtenerReporteViajesParaExportar(guard.empresa.id, filtros);
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 400 });
  }
  const planes = resultado.planes;
  // CORRECCIÓN PR #112 (HALLAZGO 2): fecha/hora de Guatemala explícita —
  // nunca el timezone implícito del proceso del servidor.
  const fecha = hoyLocal();

  if (formato === "pdf") {
    const kpi = calcularKpisReporte(planes);
    const subtitulo =
      `${guard.empresa.nombre} · ` +
      `${filtros.fechaDesde ?? "Inicio"} a ${filtros.fechaHasta ?? "Hoy"} · ` +
      `Generado ${formatearTimestampVisible(ahoraLocal())} (Guatemala) · ` +
      `${kpi.totalViajes} viaje(s) · ${kpi.cerrados} cerrado(s) · ${kpi.pendientesCierre} pendiente(s) de cierre · ` +
      `Valor programado ${moneda(kpi.valorProgramado)} · Valor cerrado ${moneda(kpi.valorCerrado)}`;
    const buffer = await tablaAPdf({
      title: "Reporte de viajes",
      subtitle: subtitulo,
      headers: HEADERS_PDF,
      rows: planes.map(filaPdf),
      layout: "landscape",
      modo: "tabla",
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reporte-viajes-${fecha}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const buffer = await tablaAExcel({
    sheetName: "Viajes",
    headers: HEADERS_EXCEL,
    rows: planes.map(filaExcel),
  });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporte-viajes-${fecha}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}

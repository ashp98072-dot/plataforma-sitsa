import { NextResponse } from "next/server";
import { requireTenantGastos } from "@/lib/tenant";
import {
  TIPOS_REPORTE_GASTOS,
  agruparSolicitudesFondo,
  filtrosReporteGastosDesdeUrl,
  obtenerReporteGastosPorTipo,
  resumenMensualFondos,
  resumirViaticosPorEstado,
  type FilaGastoDetalle,
  type FilaViaticoReporte,
  type TipoReporteGastos,
} from "@/lib/tms/reportes-gastos";
import { generarPdfMensualSolicitudesFondo } from "@/lib/tms/fondos-mensual-pdf";
import { mesCompletoDeRango } from "@/lib/tms/reportes-mes";
import {
  exportarAgregadoGastosExcel,
  exportarGastosDetalleExcel,
  exportarRentabilidadExcel,
  exportarReporteFondosExcel,
  exportarViaticosReporteExcel,
} from "@/lib/tms/gastos-export-excel";
import { tablaAPdf } from "@/lib/rrhh/export-files";
import { ahoraLocal, formatearFechaVisible, formatearTimestampVisible, hoyLocal } from "@/lib/rrhh/dates";

type Ctx = { params: Promise<{ slug: string }> };

function moneda(v: number): string {
  return `Q${v.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * REPORTES-VIATICOS-GASTOS-DETALLE-1 (§1/§4 del ticket) — PDF de detalle
 * de viáticos: columnas reducidas respecto al Excel completo (mismo
 * criterio ya usado en reportes/viajes/export/route.ts — el PDF es una
 * vista compacta, el detalle financiero completo vive en el Excel) para
 * que la tabla siga siendo legible en horizontal. Encabezado se repite
 * automáticamente en cada página nueva y nunca deja páginas en blanco —
 * eso ya lo resuelve dibujarTablaEnDoc/tablaAPdf (export-files.ts), sin
 * tocarlo. Al final: fila TOTAL GENERAL + una fila por estado.
 */
const HEADERS_PDF_VIATICOS = ["Fecha viaje", "Código", "Nombre", "Cargo", "Cuenta", "Placa", "Cliente", "Concepto", "Monto", "Estado", "Autorizado por"];
function filaPdfViatico(f: FilaViaticoReporte): string[] {
  return [
    formatearFechaVisible(f.fechaViaje) || "—", f.planCodigo, f.personalNombre, f.cargo ?? "—",
    f.cuentaBancaria ?? "—", f.placa ?? "—", f.clienteNombre ?? "—", f.rol,
    moneda(f.montoAsignado), f.estado, f.autorizadoPor ?? "—",
  ];
}

// GASTOS-OPERATIVOS-DETALLE-FORMATO-1 — primero las 9 columnas exigidas
// por el ticket en ese orden (Fecha solicitud, Fecha viaje, Nombre, Cargo,
// Placa, Cliente, Cant., Descripción, Total) y luego el resto compacto.
const HEADERS_PDF_GASTOS = ["Fecha solicitud", "Fecha viaje", "Nombre", "Cargo", "Placa", "Cliente", "Cant.", "Descripción", "Total", "Código", "Categoría", "Estado"];
function filaPdfGasto(f: FilaGastoDetalle): string[] {
  return [
    formatearFechaVisible(f.fechaSolicitud) || "—", f.fechaViaje ? formatearFechaVisible(f.fechaViaje) : "—",
    f.empleadoNombre ?? "—", f.cargo ?? "—", f.placa ?? "—", f.clienteNombre ?? "—",
    String(f.cantidad), f.descripcion ?? "—", moneda(f.total),
    f.planCodigo ?? "—", f.categoria, f.activo ? "Activo" : "Anulado",
  ];
}

function periodoTexto(fechaDesde?: string, fechaHasta?: string): string {
  return `${fechaDesde ? formatearFechaVisible(fechaDesde) : "Inicio"} a ${fechaHasta ? formatearFechaVisible(fechaHasta) : "Hoy"}`;
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo");
  if (!tipo || !(TIPOS_REPORTE_GASTOS as readonly string[]).includes(tipo)) {
    return NextResponse.json({ error: `Tipo de reporte inválido. Usa uno de: ${TIPOS_REPORTE_GASTOS.join(", ")}.` }, { status: 400 });
  }
  const formato = url.searchParams.get("formato") === "pdf" ? "pdf" : "xlsx";
  // Mismo criterio de filtros/consulta que el GET de solo lectura — nunca dos parseos que puedan divergir.
  const filtros = filtrosReporteGastosDesdeUrl(url);

  // REPORTES-MENSUALES-CONSOLIDADOS-1 — el PDF de solicitudes de fondo es
  // SIEMPRE mensual consolidado: exige que fechaSolicitudDesde/Hasta sean
  // exactamente un mes calendario completo (2026-09-01 a 2026-09-30).
  // Nunca se infiere el mes desde una sola fecha ni se acepta un rango
  // parcial o que cruce meses. Se valida ANTES de correr el reporte.
  const periodoMensualFondos = tipo === "fondos" && formato === "pdf"
    ? mesCompletoDeRango(filtros.fechaSolicitudDesde, filtros.fechaSolicitudHasta)
    : null;
  if (tipo === "fondos" && formato === "pdf" && !periodoMensualFondos) {
    return NextResponse.json(
      { error: "Selecciona un mes y año para generar el PDF mensual consolidado." },
      { status: 400 },
    );
  }

  const resultado = await obtenerReporteGastosPorTipo(guard.empresa.id, tipo as TipoReporteGastos, filtros);
  const fecha = hoyLocal();

  // REPORTES-VIATICOS-GASTOS-DETALLE-1 (§4 del ticket) — PDF SOLO para
  // los dos reportes de detalle (viáticos/gastos); los agregados/
  // rentabilidad/fondos siguen siendo Excel únicamente, sin cambios.
  if (formato === "pdf" && (resultado.tipo === "viaticos" || resultado.tipo === "gastosDetalle")) {
    const subtitulo = `${guard.empresa.nombre} · Período: ${periodoTexto(filtros.fechaDesde, filtros.fechaHasta)} · Generado ${formatearTimestampVisible(ahoraLocal())} (Guatemala) · ${resultado.filas.length} registro(s)`;

    if (resultado.tipo === "viaticos") {
      const totalGeneral = resultado.filas.reduce((s, f) => s + f.montoAsignado, 0);
      const resumen = resumirViaticosPorEstado(resultado.filas);
      const filasTotales = [
        ["", "", "", "", "", "", "", "TOTAL GENERAL", moneda(totalGeneral), `${resultado.filas.length} reg.`, ""],
        ...Object.entries(resumen).map(([estado, r]) => ["", "", "", "", "", "", "", `Total ${estado}`, moneda(r.total), `${r.cantidad} reg.`, ""]),
      ];
      const buffer = await tablaAPdf({
        title: "Reporte de viáticos — detalle",
        subtitle: subtitulo,
        headers: HEADERS_PDF_VIATICOS,
        rows: [...resultado.filas.map(filaPdfViatico), ...filasTotales],
        layout: "landscape",
        modo: "tabla",
      });
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="reporte-viaticos-${fecha}.pdf"`,
          "Cache-Control": "private, no-store",
        },
      });
    }

    const totalGeneral = resultado.filas.reduce((s, f) => s + f.total, 0);
    const filaTotal = ["", "", "", "", "", "", "", "TOTAL GENERAL", moneda(totalGeneral), `${resultado.filas.length} reg.`, "", ""];
    const buffer = await tablaAPdf({
      title: "Reporte de gastos operativos — detalle",
      subtitle: subtitulo,
      headers: HEADERS_PDF_GASTOS,
      rows: [...resultado.filas.map(filaPdfGasto), filaTotal],
      layout: "landscape",
      modo: "tabla",
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="reporte-gastos-detalle-${fecha}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  // REPORTES-MENSUALES-CONSOLIDADOS-1 — PDF mensual consolidado de
  // Solicitudes de fondo: cada solicitud como bloque independiente (tabla
  // de sus líneas + TOTAL SOLICITUD + 3 firmas históricas) y un RESUMEN
  // DEL MES al final. Reutiliza el MISMO reporte/filtros ya cargados
  // (obtenerReporteGastosPorTipo). NO reemplaza el PDF individual de
  // solicitud de fondo (fondos/[id]/pdf) ni el Excel de este reporte.
  if (formato === "pdf" && resultado.tipo === "fondos" && periodoMensualFondos) {
    const grupos = agruparSolicitudesFondo(resultado.filas);
    const resumenMes = resumenMensualFondos(grupos);
    const { anio, mes } = periodoMensualFondos;
    const buffer = await generarPdfMensualSolicitudesFondo(
      guard.empresa.id,
      guard.empresa.nombre,
      grupos,
      resumenMes,
      periodoMensualFondos,
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="solicitudes-fondo-mensual-${anio}-${String(mes).padStart(2, "0")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const buffer = await (resultado.tipo === "viaticos"
    ? exportarViaticosReporteExcel(resultado.filas)
    : resultado.tipo === "rentabilidad"
      ? exportarRentabilidadExcel(resultado.filas)
      : resultado.tipo === "fondos"
        ? exportarReporteFondosExcel(resultado.filas)
        : resultado.tipo === "gastosDetalle"
          ? exportarGastosDetalleExcel(resultado.filas)
          : exportarAgregadoGastosExcel(`Gastos por ${resultado.tipo}`, resultado.etiqueta, resultado.filas));

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="reporte-gastos-${tipo}-${fecha}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}

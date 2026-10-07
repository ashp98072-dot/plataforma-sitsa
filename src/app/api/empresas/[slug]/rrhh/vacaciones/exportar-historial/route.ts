import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { cargarHistorialActual } from "@/lib/rrhh/vacaciones-historial-actual";
import { construirCsvHistorial } from "@/lib/rrhh/vacaciones-historial-export";
import { construirXlsxHistorial } from "@/lib/rrhh/vacaciones-historial-export-xlsx";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Exportar historial actual de vacaciones (XLSX o CSV) en el formato exacto de «Importar historial (solo vista previa)».
 * SOLO LECTURA: únicamente consulta; el archivo se arma en memoria y no se guarda nada. La empresa sale del slug/sesión.
 * Permiso: RRHH · Vacaciones · editar (el archivo incluye DPI). Las vacaciones cuyo tipo no se puede resolver con certeza NO salen
 * en el archivo: se informan en el encabezado `X-Export-Problemas` y, en XLSX, en la hoja «Problemas».
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;

  const formato = (new URL(req.url).searchParams.get("formato") ?? "xlsx").toLowerCase();
  if (formato !== "xlsx" && formato !== "csv") return NextResponse.json({ error: "Formato no soportado: usa xlsx o csv." }, { status: 400 });

  try {
    const historial = await cargarHistorialActual(guard.empresa.id);
    const sello = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const base = `historial-vacaciones-actual-${slug}-${sello}`;
    const comunes = {
      "Cache-Control": "private, no-store",
      "X-Export-Filas": String(historial.resumen.filasExportadas),
      "X-Export-Problemas": String(historial.resumen.problemasError),
    };
    if (formato === "csv") {
      return new NextResponse(construirCsvHistorial(historial.filas), {
        headers: { ...comunes, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"` },
      });
    }
    const buffer = await construirXlsxHistorial(historial);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        ...comunes,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
      },
    });
  } catch (error) {
    console.error("[vacaciones/exportar-historial]", error);
    return NextResponse.json({ error: "No se pudo generar el historial." }, { status: 500 });
  }
}

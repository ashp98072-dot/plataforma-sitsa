import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import {
  contarReporteViajes,
  filtrosReporteDesdeUrl,
  obtenerKpisReporte,
  obtenerReporteViajes,
  LIMITE_PAGINA_DEFECTO,
  LIMITE_PAGINA_MAXIMO,
} from "@/lib/tms/reportes-viajes";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * TMS-REPORTES-1 — lectura: mismo permiso ya usado por TMS/Programación
 * (programacion:ver O tms:ver, requireTenantProgramacionOTms) — no se
 * crea un permiso nuevo. Los filtros se parsean en
 * src/lib/tms/reportes-viajes.ts (filtrosReporteDesdeUrl) para que este
 * endpoint y su exportador (export/route.ts) apliquen EXACTAMENTE el
 * mismo criterio.
 *
 * CORRECCIÓN PR #112 (HALLAZGO 3): el listado ya NO trae todo el
 * histórico filtrado a memoria (antes: LIMIT 2000 fijo, que podía
 * truncar la tabla, el Excel/PDF y el KPI sin avisar). Ahora:
 *   - el listado de la tabla es paginado server-side (page/pageSize) y
 *     devuelve totalReal para que la UI muestre "X–Y de Z";
 *   - el KPI se calcula con agregación SQL sobre TODO el filtro
 *     (obtenerKpisReporte), independiente de la página visible;
 *   - la exportación (export/route.ts) usa una función aparte que trae
 *     TODO el filtro, sin este límite de página.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const filtros = filtrosReporteDesdeUrl(url);
  const pageRaw = Number(url.searchParams.get("page"));
  const pageSizeRaw = Number(url.searchParams.get("pageSize"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize =
    Number.isInteger(pageSizeRaw) && pageSizeRaw > 0
      ? Math.min(pageSizeRaw, LIMITE_PAGINA_MAXIMO)
      : LIMITE_PAGINA_DEFECTO;

  const [planes, kpi, totalReal] = await Promise.all([
    obtenerReporteViajes(guard.empresa.id, filtros, { limit: pageSize, offset: (page - 1) * pageSize }),
    obtenerKpisReporte(guard.empresa.id, filtros),
    contarReporteViajes(guard.empresa.id, filtros),
  ]);

  return NextResponse.json(
    { planes, kpi, totalReal, page, pageSize },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

import { NextResponse } from "next/server";
import { requireTenantProgramacionExportar } from "@/lib/tenant";
import { consultarKpiPriceSmart, KpiInputError } from "@/lib/integrations/pricesmart/lab-demo/kpi-entry";

/**
 * PRICESMART KPI (laboratorio/sandbox) — consulta y exportación INTERNA de indicadores. Solo personal autenticado con permiso de exportar Programación; la empresa sale de la sesión (nunca del navegador).
 * `?formato=csv|json`, `desde`, `hasta` (AAAA-MM-DD), `clienteId`, `limite`. Fuera del laboratorio/sandbox responde 404. No es público y no declara entregas confirmadas (D13).
 */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionExportar(slug);
  if (guard.error) return guard.error;
  const u = new URL(req.url); const num = (k: string) => (u.searchParams.get(k) ? Number(u.searchParams.get(k)) : undefined);
  try {
    const r = await consultarKpiPriceSmart({ empresaId: guard.empresa.id, clienteId: num("clienteId"), desde: u.searchParams.get("desde") || undefined, hasta: u.searchParams.get("hasta") || undefined, limite: num("limite") });
    if (!r.enabled) return NextResponse.json({ error: "No disponible." }, { status: 404 });
    const headers = { "Cache-Control": "private, no-store" };
    if (u.searchParams.get("formato") === "csv") return new NextResponse(r.csv, { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="pricesmart-kpi.csv"' } });
    return NextResponse.json({ filas: r.rows }, { headers });
  } catch (e) {
    if (e instanceof KpiInputError) return NextResponse.json({ error: "Parámetros inválidos." }, { status: 400 });
    throw e;
  }
}

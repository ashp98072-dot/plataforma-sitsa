import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { buscarLineasFondoCombustible } from "@/lib/flota/combustible-fondos";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);
  // Selección: registrar OR editar pendientes, nunca concede editar Fondos.
  // Resumen: ver. Se valida nuevamente el tenant en cada guard existente.
  const resumen = url.searchParams.has("lineaId");
  let guard = await requireTenantFlotaCombustible(slug, resumen ? "ver" : "registrar");
  if (guard.error && !resumen && guard.error.status === 403) guard = await requireTenantFlotaCombustible(slug, "editar_pendientes");
  if (guard.error) return guard.error;
  const lineaId = resumen ? Number(url.searchParams.get("lineaId")) : undefined;
  if (resumen && (!Number.isSafeInteger(lineaId) || lineaId! <= 0)) return NextResponse.json({ error: "Línea inválida." }, { status: 400 });
  const items = await buscarLineasFondoCombustible(guard.empresa.id, url.searchParams.get("q") ?? "", lineaId);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}

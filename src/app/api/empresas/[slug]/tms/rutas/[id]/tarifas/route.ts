import { NextResponse } from "next/server";
import { requireTenantRutas } from "@/lib/tenant";
import { listarHistorialTarifas, obtenerRuta } from "@/lib/tms/cliente-rutas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§4 del ticket) — "Historial de tarifas"
 * de una ruta: fecha, tarifa, vigente desde, motivo, modificado por —
 * orden descendente (ya lo hace listarHistorialTarifas). Nunca permite
 * editar/borrar desde aquí — este endpoint es GET únicamente, el
 * historial es append-only (registrarCambioTarifaTx en cliente-rutas.ts).
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRutas(slug, "ver");
  if (guard.error) return guard.error;

  const rutaId = Number(id);
  if (!Number.isFinite(rutaId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const ruta = await obtenerRuta(guard.empresa.id, rutaId);
  if (!ruta) {
    return NextResponse.json({ error: "Ruta no encontrada." }, { status: 404 });
  }
  const historial = await listarHistorialTarifas(guard.empresa.id, rutaId);
  return NextResponse.json({ historial }, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { simularReconstruccion } from "@/lib/rrhh/vacaciones-reconstruccion-aplicador";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * Reconstrucción de vacaciones — DRY-RUN. SOLO LECTURA: calcula el plan completo (vacaciones, incidencias y FIFO nuevos, relink de
 * evidencias, saldo final por empleado, decisiones pendientes, `puedeAplicarse`) sin escribir NADA. No existe en esta API ninguna ruta
 * que APLIQUE la reconstrucción: ese paso queda fuera de este PR. La empresa sale del slug/sesión. Permiso: RRHH · Vacaciones · editar.
 * Cuerpo opcional: { "decisiones": [...] } con las resoluciones explícitas y auditables de las decisiones pendientes.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;

  let decisiones: unknown;
  try {
    const texto = await req.text();
    if (texto.length > 200_000) return NextResponse.json({ error: "El cuerpo supera 200 KB." }, { status: 413 });
    if (texto.trim()) decisiones = (JSON.parse(texto) as { decisiones?: unknown }).decisiones;
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON válido: { \"decisiones\": [...] }." }, { status: 400 });
  }
  try {
    const resultado = await simularReconstruccion(guard.empresa.id, decisiones);
    return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[vacaciones/reconstruccion/dry-run]", error);
    return NextResponse.json({ error: "No se pudo generar el dry-run de la reconstrucción." }, { status: 500 });
  }
}

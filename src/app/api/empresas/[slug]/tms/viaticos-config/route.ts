import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { guardarViaticoConfig, listarViaticosConfig } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * VIAT-0 (punto 5) — viático predeterminado por puesto operativo (Piloto,
 * Auxiliar, extensible). Uso interno TMS/RRHH; nunca se expone a
 * cliente/facturación.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const config = await listarViaticosConfig(guard.empresa.id);
  return NextResponse.json(
    { config },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  puesto: z.string().min(1).max(60),
  montoDefecto: z.number().nonnegative(),
});

export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  await guardarViaticoConfig(
    guard.empresa.id,
    parsed.data.puesto,
    parsed.data.montoDefecto,
    guard.session.username,
  );
  return NextResponse.json({ mensaje: "Viático predeterminado actualizado." });
}

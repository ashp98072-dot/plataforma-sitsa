import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCotizacionesAjustes } from "@/lib/tenant";
import { DOCUMENTOS_EMISOR } from "@/lib/tms/cotizacion-documento";
import { guardarPresentacionComercial, obtenerPresentacionComercial } from "@/lib/tms/cotizacion-presentacion";

type Ctx = { params: Promise<{ slug: string }> };
const H = { "Cache-Control": "private, no-store" };

/**
 * Ajustes → Presentación comercial: mensaje/cierre PREDETERMINADOS por
 * marca (solo plantilla para nuevas cotizaciones — ver
 * cotizacion-presentacion.ts). Nunca modifica cotizaciones ya creadas.
 */
const marcaSchema = z.object({
  mensaje: z.string().max(2000).optional(),
  cierre: z.string().max(2000).optional(),
});
const schema = z.object(Object.fromEntries(DOCUMENTOS_EMISOR.map((m) => [m, marcaSchema.optional()])));

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantCotizacionesAjustes(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: H });

  try {
    await guardarPresentacionComercial(guard.empresa.id, parsed.data);
    const presentacion = await obtenerPresentacionComercial(guard.empresa.id);
    return NextResponse.json({ mensaje: "Presentación comercial guardada.", presentacion }, { headers: H });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo guardar." }, { status: 400, headers: H });
  }
}

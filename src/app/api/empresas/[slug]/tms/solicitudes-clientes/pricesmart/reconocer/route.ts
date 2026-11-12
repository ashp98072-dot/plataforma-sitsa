import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacion } from "@/lib/tenant";
import { reconocerVinculacion } from "@/lib/integrations/pricesmart/lab-demo/ops-view";

const schema = z.object({ id: z.string().regex(/^[0-9A-Fa-f]{32}$/) }).strict();

/** PRICESMART API-13 (laboratorio) — «Reconocer» una vinculación pendiente o fallida. Solo deja constancia (usuario, fecha, auditoría); no reintenta ni toca solicitudes, planes ni viajes. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await reconocerVinculacion(guard.empresa.id, parsed.data.id, guard.session.username);
  if (r === "DESHABILITADO") return NextResponse.json({ error: "No disponible." }, { status: 404 });
  if (r === "NO_ENCONTRADA") return NextResponse.json({ error: "Vinculación no encontrada." }, { status: 404 });
  return NextResponse.json({ mensaje: "Vinculación reconocida." });
}

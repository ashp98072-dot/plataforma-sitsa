import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacion } from "@/lib/tenant";
import { CANCELLATION_RESOLUTIONS, NOTE_MAX, resolverCancelacionPriceSmart } from "@/lib/integrations/pricesmart/lab-demo/ops-view";

const schema = z.object({ solicitudId: z.number().int().positive(), resolucion: z.enum(CANCELLATION_RESOLUTIONS), nota: z.string().max(NOTE_MAX).optional() }).strict();

/**
 * PRICESMART API-27 (laboratorio) — Operaciones RESUELVE la cancelación pedida por PriceSmart. Solo deja constancia (quién, cuándo, nota, auditoría): NO cancela solicitudes, planes ni viajes.
 * `EXECUTED` solo se acepta si el TMS ya refleja la cancelación; `NOT_EXECUTED` exige nota. Mismo permiso que el resto de la bandeja (Programación, editar); la empresa sale de la sesión.
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  const r = await resolverCancelacionPriceSmart(guard.empresa.id, parsed.data.solicitudId, parsed.data.resolucion, guard.session.username, parsed.data.nota);
  switch (r) {
    case "DESHABILITADO": case "NOT_FOUND": return NextResponse.json({ error: "No encontrada." }, { status: 404 });
    case "NOT_REQUESTED": return NextResponse.json({ error: "La solicitud no tiene una cancelación pedida." }, { status: 409 });
    case "ALREADY_RESOLVED": return NextResponse.json({ error: "La cancelación ya fue resuelta." }, { status: 409 });
    case "STATE_CONFLICT": return NextResponse.json({ error: "El estado actual del TMS no corresponde a esa resolución." }, { status: 409 });
    case "NOTE_REQUIRED": case "INVALID": return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    default: return NextResponse.json({ mensaje: "Cancelación resuelta." });
  }
}

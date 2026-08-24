import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViaticos } from "@/lib/tenant";
import { liquidarViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  observaciones: z.string().max(300).optional().nullable(),
});

/**
 * VIAT-1 — ENTREGADO -> LIQUIDADO. Permiso EXPLÍCITO `viaticos:editar`. En
 * esta fase "liquidar" significa solo cierre administrativo (observaciones
 * de texto libre) — no implica devolución de sobrante ni comprobantes.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViaticos(slug, "editar");
  if (guard.error) return guard.error;

  const viaticoId = Number(id);
  if (!Number.isFinite(viaticoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const r = await liquidarViatico(
    guard.empresa.id,
    viaticoId,
    { observaciones: d.observaciones ?? null },
    guard.session.username,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ mensaje: "Viático liquidado." });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViaticos } from "@/lib/tenant";
import { registrarEntregaViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "CHEQUE"]),
  referenciaPago: z.string().max(100).optional().nullable(),
  observaciones: z.string().max(300).optional().nullable(),
});

/**
 * VIAT-1 — AUTORIZADO -> ENTREGADO. Permiso EXPLÍCITO `viaticos:editar`,
 * igual que autorizar/liquidar — no se asume que quien autoriza pueda
 * entregar por ser supervisor; el mismo permiso reutilizado cubre las tres
 * acciones (ver justificación en src/lib/permisos-shared.ts).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViaticos(slug, "editar");
  if (guard.error) return guard.error;

  const viaticoId = Number(id);
  if (!Number.isFinite(viaticoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const r = await registrarEntregaViatico(
    guard.empresa.id,
    viaticoId,
    {
      metodoPago: d.metodoPago,
      referenciaPago: d.referenciaPago ?? null,
      observaciones: d.observaciones ?? null,
    },
    guard.session.username,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  return NextResponse.json({ mensaje: "Entrega registrada." });
}

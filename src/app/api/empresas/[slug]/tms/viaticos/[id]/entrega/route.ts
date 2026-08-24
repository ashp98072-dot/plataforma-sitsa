import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViaticosPagar } from "@/lib/tenant";
import { registrarEntregaViatico } from "@/lib/tms/viaticos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  metodoPago: z.enum(["EFECTIVO", "TRANSFERENCIA", "CHEQUE"]),
  referenciaPago: z.string().max(100).optional().nullable(),
  observaciones: z.string().max(300).optional().nullable(),
});

/**
 * VIAT-2 — AUTORIZADO -> ENTREGADO. "OPERACIONES AUTORIZA, FACTURADOR
 * PAGA": permiso EXPLÍCITO `viaticos_pagar:editar`
 * (requireTenantViaticosPagar), separado de `viaticos_autorizar` — quien
 * autorizó no puede entregar solo por eso, y viceversa. El body nunca
 * acepta monto/monto_asignado — actualizarMontoViatico además bloquea
 * cualquier cambio de monto fuera de PROGRAMADO, así que el facturador no
 * puede modificarlo aunque lo intentara por otra vía.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViaticosPagar(slug, "editar");
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

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { actualizarMontoViatico } from "@/lib/tms/viaticos";
import { sincronizarFondosTrasViatico } from "@/lib/tms/fondos-diarios-viatico";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  montoAsignado: z.number().nonnegative(),
  motivoCambio: z.string().max(300).optional(),
});

/**
 * VIAT-0 (punto 7) — modifica el monto asignado de UN viático ya existente
 * (creado automáticamente al asignar piloto/auxiliares). Si el monto difiere
 * del sugerido, exige motivo (actualizarMontoViatico lo valida de nuevo
 * server-side, nunca se confía solo en que la UI ya lo pidió). Guarda quién
 * hizo el cambio. No permite marcar ENTREGADO/LIQUIDADO ni cambiar estado —
 * ese endpoint no existe todavía (fase VIAT-1, operativa, sin relación con
 * Planillas/nómina).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
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

  const r = await actualizarMontoViatico(
    guard.empresa.id,
    viaticoId,
    d.montoAsignado,
    d.motivoCambio ?? null,
    guard.session.username,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  // FONDOS DIARIOS: el monto ya está confirmado; se refleja en la solicitud (diferencial, sin duplicar; autorizada intacta). Si no se pudo, se AVISA (el monto no se revierte).
  const s = guard.session;
  const { advertenciaFondos } = await sincronizarFondosTrasViatico(guard.empresa.id, viaticoId, { usuarioId: s.id, nombre: s.nombre || s.username, username: s.username });
  return NextResponse.json({ mensaje: "Viático actualizado.", ...(advertenciaFondos ? { advertenciaFondos } : {}) });
}

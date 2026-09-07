import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesCerrar } from "@/lib/tenant";
import { cerrarViaje, cerrarViajeManual } from "@/lib/tms/cierre-viaje";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * TMS-CIERRE-OPERACIONES-1 — body opcional; sin `manual` (o `manual:
 * false`) el comportamiento es EXACTAMENTE el de siempre (cierre normal,
 * exige llegada real registrada). `manual: true` activa el cierre
 * administrativo forzado — mismo permiso `viajes_cerrar:editar`, decisión
 * de negocio ya confirmada (ver docs/TMS-CIERRE-OPERACIONES-1-DISCOVERY.md).
 */
const bodySchema = z.object({
  manual: z.boolean().optional(),
  motivo: z.string().optional(),
  comentario: z.string().optional(),
});

/**
 * OPS-1 — cierre administrativo del viaje: Descargado -> Cerrado.
 * Permiso EXPLÍCITO `viajes_cerrar:editar` (requireTenantViajesCerrar) —
 * NUNCA por rol (ni "JefeOperaciones" ni ningún otro nombre de rol es
 * autoridad aquí, solo el permiso). El piloto no tiene acceso a este
 * endpoint (vive fuera de /api/portal); Auxiliar de Operaciones y
 * Facturador tampoco lo tienen por defecto — ver
 * src/lib/permisos-shared.ts.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantViajesCerrar(slug, "editar");
  if (guard.error) return guard.error;

  const planId = Number(id);
  if (!Number.isFinite(planId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  // Sin body (llamadas existentes) o body inválido: se trata como cierre
  // normal, sin romper ningún caller actual.
  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  const body = parsed.success ? parsed.data : {};

  if (body.manual) {
    if (!body.motivo || !body.motivo.trim()) {
      return NextResponse.json(
        { error: "El motivo es obligatorio para el cierre manual." },
        { status: 400 },
      );
    }
    const r = await cerrarViajeManual({
      empresaId: guard.empresa.id,
      planId,
      usuario: guard.session.username,
      motivo: body.motivo,
      comentario: body.comentario ?? null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 409 });
    return NextResponse.json({ mensaje: "Viaje cerrado manualmente." });
  }

  const r = await cerrarViaje(guard.empresa.id, planId, guard.session.username);
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 409 });
  }
  return NextResponse.json({ mensaje: "Viaje cerrado." });
}

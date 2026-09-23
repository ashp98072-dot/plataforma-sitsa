import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesCerrar } from "@/lib/tenant";
import { cerrarViajesMasivo, MAX_PLANES_CIERRE_MASIVO } from "@/lib/tms/cierre-masivo";

type Ctx = { params: Promise<{ slug: string }> };

const planIds = z.array(z.number().int().positive()).min(1).max(MAX_PLANES_CIERRE_MASIVO);
const grupo = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

/**
 * Esquema ESTRICTO: NORMAL no acepta motivo/comentario; MANUAL exige motivo
 * común (5–500) y admite comentario común opcional (≤1000). Sin empresa_id:
 * la empresa sale siempre de la sesión.
 */
const bodySchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("NORMAL"), planIds, grupo }).strict(),
  z.object({
    tipo: z.literal("MANUAL"),
    planIds,
    grupo,
    motivo: z.string().trim().min(5, "El motivo debe tener al menos 5 caracteres.").max(500, "El motivo no puede superar 500 caracteres."),
    comentario: z.string().trim().max(1000, "El comentario no puede superar 1000 caracteres.").optional(),
  }).strict(),
]);

/**
 * TMS-CIERRE-MASIVO-1 — POST /tms/planes/cerrar-masivo. Mismo permiso que el
 * cierre individual (`viajes_cerrar:editar`, nunca por rol). Procesa viaje por
 * viaje con cerrarViaje / cerrarViajeManual (sin transacción global) y
 * responde { cerrados, omitidos, errores }.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViajesCerrar(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const body = parsed.data;
  const resultado = await cerrarViajesMasivo({
    empresaId: guard.empresa.id,
    usuario: guard.session.username,
    tipo: body.tipo,
    planIds: body.planIds,
    motivo: body.tipo === "MANUAL" ? body.motivo : undefined,
    comentario: body.tipo === "MANUAL" ? body.comentario || null : null,
    grupo: body.grupo ?? null,
  });
  return NextResponse.json(resultado, { headers: { "Cache-Control": "private, no-store" } });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantViajesCargosAdicionales } from "@/lib/tenant";
import { editarCargoAdicional } from "@/lib/tms/cargos-adicionales";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; id: string; cargoId: string }> };

const editarSchema = z
  .object({
    expectedVersion: z.number().int().min(1).max(2147483647),
    concepto: z.string().max(200).optional(),
    monto: z.union([z.number(), z.string().max(30)]).optional(),
    observacion: z.string().max(1000).nullable().optional(),
  })
  .strict();

/**
 * Edita concepto/monto/observación de un cargo ACTIVO (permiso `viajes_cargos_adicionales:editar`). `expectedVersion` es
 * obligatorio (concurrencia optimista). Un cargo se identifica SIEMPRE junto con su viaje y la empresa de la sesión.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id, cargoId } = await ctx.params;
  const guard = await requireTenantViajesCargosAdicionales(slug, "editar");
  if (guard.error) return guard.error;
  const planId = Number(id);
  const cId = Number(cargoId);
  if (!Number.isInteger(planId) || planId <= 0 || !Number.isInteger(cId) || cId <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const parsed = editarSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida: se requiere expectedVersion." }, { status: 400 });
  try {
    const { expectedVersion, ...campos } = parsed.data;
    const r = await editarCargoAdicional(
      { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
      { planId, cargoId: cId, versionEsperada: expectedVersion, ...campos },
    );
    return NextResponse.json({ mensaje: r.evento ? "Cargo actualizado." : "Sin cambios.", idempotente: r.idempotente, evento: r.evento, cargo: r.cargo });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}

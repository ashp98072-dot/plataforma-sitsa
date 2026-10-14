import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { respuestaDeExcepcion } from "@/lib/validacion-formulario";
import { revertirJustificacion } from "@/lib/rrhh/justificaciones-faltas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z
  .object({ expectedVersion: z.number().int().min(1).max(2147483647), motivo: z.string().max(500) })
  .strict();

/**
 * Revierte (NO borra) una justificación con motivo obligatorio. Permiso `incidencias:editar`. La falta vuelve a mostrarse como
 * «Falta»; el historial queda en la tabla (estado REVERTIDA, quién/cuándo/motivo) y en la bitácora de auditoría.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "incidencias", "editar");
  if (guard.error) return guard.error;
  const justId = Number(id);
  if (!Number.isInteger(justId) || justId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida: se requieren expectedVersion y motivo." }, { status: 400 });
  try {
    const r = await revertirJustificacion(
      { empresaId: guard.empresa.id, usuario: guard.session.username },
      { id: justId, versionEsperada: parsed.data.expectedVersion, motivo: parsed.data.motivo },
    );
    return NextResponse.json({ mensaje: r.idempotente ? "La justificación ya estaba revertida." : "Justificación revertida.", idempotente: r.idempotente, evento: r.evento, justificacion: r.justificacion });
  } catch (e) {
    const f = respuestaDeExcepcion(e);
    return NextResponse.json(f.cuerpo, { status: f.status });
  }
}

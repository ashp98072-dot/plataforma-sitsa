import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacion } from "@/lib/tenant";
import { actualizarPersonalOperativo } from "@/lib/tms/personal-operativo";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  nombre: z.string().min(1).max(200).optional(),
  telefono: z.string().max(80).nullish(),
  licencia: z.string().max(80).nullish(),
  empresaOrigenTexto: z.string().max(200).nullish(),
  activo: z.boolean().optional(),
});

/**
 * PERSONAL-OPERATIVO-COMPARTIDO-EXTERNO-1 — edita / activa / desactiva un
 * tms_personal. Desactivar impide usarlo en viajes nuevos pero NO altera
 * viajes/viáticos históricos. Nunca cambia empresa_id ni id_empleado.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;
  const pid = Number(id);
  if (!Number.isFinite(pid)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const actor = { usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username };
    const personal = await actualizarPersonalOperativo(guard.empresa.id, pid, parsed.data, actor);
    if (!personal) return NextResponse.json({ error: "Personal no encontrado." }, { status: 404 });
    return NextResponse.json({ personal, mensaje: "Personal actualizado." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar." },
      { status: 400 },
    );
  }
}

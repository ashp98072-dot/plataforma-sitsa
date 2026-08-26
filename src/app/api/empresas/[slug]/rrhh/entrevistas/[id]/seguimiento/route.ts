import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEntrevista } from "@/lib/rrhh/entrevistas";
import { agregarComentario, listarUsuariosReclutamiento, obtenerSeguimiento, reemplazarResponsables } from "@/lib/rrhh/reclutamiento-seguimiento";
type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver"); if (guard.error) return guard.error;
  const id = Number(raw); const entrevista = await obtenerEntrevista(guard.empresa.id, id);
  if (!entrevista) return NextResponse.json({ error: "Entrevista no encontrada." }, { status: 404 });
  const [seguimiento, usuarios] = await Promise.all([obtenerSeguimiento(guard.empresa.id, id), listarUsuariosReclutamiento(guard.empresa.id)]);
  return NextResponse.json({ entrevista, ...seguimiento, usuarios }, { headers: { "Cache-Control": "private, no-store" } });
}

const schema = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("responsables"), usuarioIds: z.array(z.number().int().positive()).max(20) }),
  z.object({ accion: z.literal("comentar"), comentario: z.string().trim().min(1).max(5000) }),
]);
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "editar"); if (guard.error) return guard.error;
  const id = Number(raw); const parsed = schema.safeParse(await req.json());
  if (!id || !parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  try {
    if (parsed.data.accion === "responsables") await reemplazarResponsables({ empresaId: guard.empresa.id, entrevistaId: id, usuarioIds: parsed.data.usuarioIds, asignadoPor: guard.session.id });
    else await agregarComentario({ empresaId: guard.empresa.id, entrevistaId: id, usuarioId: guard.session.id, comentario: parsed.data.comentario });
    return NextResponse.json({ mensaje: parsed.data.accion === "responsables" ? "Responsables actualizados." : "Seguimiento registrado." });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo actualizar." }, { status: 400 }); }
}

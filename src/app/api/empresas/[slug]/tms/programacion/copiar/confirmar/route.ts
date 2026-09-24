import { NextResponse } from "next/server";
import { requireTenantProgramacion } from "@/lib/tenant";
import { confirmarLote } from "@/lib/tms/programacion-lote";
import { borradoresDesdeCliente } from "@/lib/tms/programacion-copia";
import { cuerpoCopiaSchema } from "@/lib/tms/programacion-copia-schema";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * POST: crea el lote COMPLETO o nada (revalida todo bajo el candado por empresa). Permiso `programacion:crear`;
 * la empresa y el usuario salen SIEMPRE de la sesión (el cuerpo no acepta empresa_id).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "crear");
  if (guard.error) return guard.error;
  const parsed = cuerpoCopiaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { fechaOrigen, fechaDestino, filas } = parsed.data;
  const b = await borradoresDesdeCliente(guard.empresa.id, fechaOrigen, filas);
  if (!b.ok) return NextResponse.json({ error: b.error }, { status: 400 });
  const r = await confirmarLote(guard.empresa.id, guard.session.username, fechaDestino, { tipo: "COPIA", fechaOrigen }, b.borradores);
  if (!r.ok) return NextResponse.json({ error: r.error, erroresPorFila: r.erroresPorFila }, { status: r.status });
  return NextResponse.json({ creados: r.planIds.length, planIds: r.planIds, codigos: r.codigos }, { headers: { "Cache-Control": "private, no-store" } });
}

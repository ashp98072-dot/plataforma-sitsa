import { NextResponse } from "next/server";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { validarLote } from "@/lib/tms/programacion-lote";
import { borradoresDesdeCliente } from "@/lib/tms/programacion-copia";
import { cuerpoCopiaSchema } from "@/lib/tms/programacion-copia-schema";

type Ctx = { params: Promise<{ slug: string }> };

/** POST: revalida las filas editadas contra la fecha destino (solo lectura). `programacion:ver`; empresa de la sesión. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug, "ver");
  if (guard.error) return guard.error;
  const parsed = cuerpoCopiaSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  const { fechaOrigen, fechaDestino, filas } = parsed.data;
  const b = await borradoresDesdeCliente(guard.empresa.id, fechaOrigen, filas);
  if (!b.ok) return NextResponse.json({ error: b.error }, { status: 400 });
  const validacion = await validarLote(guard.empresa.id, fechaDestino, b.borradores);
  return NextResponse.json({ validacion }, { headers: { "Cache-Control": "private, no-store" } });
}

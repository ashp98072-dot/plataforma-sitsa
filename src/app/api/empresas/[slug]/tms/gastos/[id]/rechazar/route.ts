import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { rechazarGasto } from "@/lib/tms/gastos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({ motivoRechazo: z.string().trim().min(1).max(300) });

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastosOperativosAutorizar(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Indica un motivo de rechazo válido." }, { status: 400 });
  }

  try {
    const gasto = await rechazarGasto(guard.empresa.id, Number(id), {
      usuario: guard.session.username,
      motivoRechazo: parsed.data.motivoRechazo,
    });
    if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    return NextResponse.json({ mensaje: "Gasto rechazado.", gasto });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo rechazar el gasto." },
      { status: 400 },
    );
  }
}

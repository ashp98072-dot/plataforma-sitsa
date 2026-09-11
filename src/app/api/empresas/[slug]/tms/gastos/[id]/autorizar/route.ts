import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastosOperativosAutorizar } from "@/lib/tenant";
import { autorizarGasto } from "@/lib/tms/gastos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  autorizanteEmpleadoId: z.number().int().positive().nullable().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastosOperativosAutorizar(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const gasto = await autorizarGasto(guard.empresa.id, Number(id), {
      usuario: guard.session.username,
      autorizanteUsuarioId: guard.session.id,
      autorizanteNombre: guard.session.nombre || guard.session.username,
      autorizanteEmpleadoId: parsed.data.autorizanteEmpleadoId,
    });
    if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    return NextResponse.json({ mensaje: "Gasto autorizado.", gasto });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo autorizar el gasto." },
      { status: 400 },
    );
  }
}

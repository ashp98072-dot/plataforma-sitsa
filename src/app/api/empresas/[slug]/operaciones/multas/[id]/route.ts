import { NextResponse } from "next/server";
import { requireTenantMultas } from "@/lib/tenant";
import { actualizarMulta } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";
import { idSchema } from "@/lib/multas/reglas";

type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { slug, id } = await ctx.params;
    const guard = await requireTenantMultas(slug, "editar");
    if (guard.error) return guard.error;
    return NextResponse.json(await actualizarMulta({ empresaId: guard.empresa.id, usuarioId: guard.session.id,
      usuario: guard.session.username }, idSchema.parse(id), await req.json()));
  } catch (error) { return errorMultas(error); }
}

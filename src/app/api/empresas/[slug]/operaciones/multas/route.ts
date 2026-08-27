import { NextResponse } from "next/server";
import { requireTenantMultas } from "@/lib/tenant";
import { crearMulta, listarMultas } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";

type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenantMultas(slug, "ver");
    if (guard.error) return guard.error;
    return NextResponse.json(await listarMultas(guard.empresa.id, Object.fromEntries(new URL(req.url).searchParams)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorMultas(error); }
}
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenantMultas(slug, "crear");
    if (guard.error) return guard.error;
    return NextResponse.json(await crearMulta({ empresaId: guard.empresa.id, usuarioId: guard.session.id,
      usuario: guard.session.username }, await req.json()), { status: 201 });
  } catch (error) { return errorMultas(error); }
}

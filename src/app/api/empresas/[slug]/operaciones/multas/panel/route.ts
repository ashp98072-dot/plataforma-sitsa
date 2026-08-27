import { NextResponse } from "next/server";
import { requireTenantMultas } from "@/lib/tenant";
import { panelMensualMultas } from "@/lib/multas/backend";
import { errorMultas } from "@/lib/multas/http";

type Ctx = { params: Promise<{ slug: string }> };

/** MULTAS-4 base (secciones 22-23) — dashboard mensual + tabla de unidades. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const { slug } = await ctx.params;
    const guard = await requireTenantMultas(slug, "ver");
    if (guard.error) return guard.error;
    return NextResponse.json(
      await panelMensualMultas(guard.empresa.id, Object.fromEntries(new URL(req.url).searchParams)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) { return errorMultas(error); }
}

import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { infoCodigoParaMarcaje } from "@/lib/rrhh/marcajes";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "marcajes", "ver");
  if (guard.error) return guard.error;
  const codigo = new URL(req.url).searchParams.get("codigo") ?? "";
  const info = await infoCodigoParaMarcaje(guard.empresa.id, codigo);
  return NextResponse.json({ info });
}

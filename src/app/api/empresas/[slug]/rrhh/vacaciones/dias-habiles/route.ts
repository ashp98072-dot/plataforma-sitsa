import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { contarDiasHabiles } from "@/lib/rrhh/vacaciones";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const inicio = url.searchParams.get("inicio") ?? "";
  const fin = url.searchParams.get("fin") ?? "";
  if (!inicio || !fin) {
    return NextResponse.json({ error: "inicio y fin requeridos." }, { status: 400 });
  }
  const dias = await contarDiasHabiles(guard.empresa.id, inicio, fin);
  return NextResponse.json({ dias });
}

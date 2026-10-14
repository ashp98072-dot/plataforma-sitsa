import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { contarDiasHabiles } from "@/lib/rrhh/vacaciones";
import { RangoVacacionesInvalido, validarDiasCalculados } from "@/lib/rrhh/vacaciones-calendario";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "ver");
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const inicio = url.searchParams.get("inicio") ?? "";
  const fin = url.searchParams.get("fin") ?? "";
  if (!inicio || !fin) {
    return NextResponse.json({ error: "inicio y fin requeridos." }, { status: 400 });
  }
  try {
    const dias = validarDiasCalculados(inicio, fin, await contarDiasHabiles(guard.empresa.id, inicio, fin));
    return NextResponse.json({ dias }, {headers:{"Cache-Control":"private, no-store"}});
  } catch(e) {
    if(e instanceof RangoVacacionesInvalido)return NextResponse.json({error:e.message},{status:400});
    return NextResponse.json({error:"No se pudo calcular los días."},{status:500});
  }
}

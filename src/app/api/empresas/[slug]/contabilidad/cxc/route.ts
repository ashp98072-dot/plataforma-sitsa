import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { crearRegistro, errorRegistro } from "@/lib/contabilidad/registros";

import { ambitoDesdeRequest, consultarLibro, errorAmbito } from "@/lib/contabilidad/ambito";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) return guard.error;
  try {
    const rows = await consultarLibro("cxc", guard.empresa.id, ambitoDesdeRequest(req, guard.session));
    return NextResponse.json({ cxc: rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorAmbito(error) ?? NextResponse.json({ error: "No se pudo consultar el libro." }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad", true);
  if (guard.error) return guard.error;
  const body = await req.json().catch(() => null);
  try {
    const id = await crearRegistro("cxc", guard.empresa.id, guard.session.username, body, ambitoDesdeRequest(req, guard.session));
    return NextResponse.json({ id, mensaje: "CxC registrada." });
  } catch (error) { return errorRegistro(error); }
}

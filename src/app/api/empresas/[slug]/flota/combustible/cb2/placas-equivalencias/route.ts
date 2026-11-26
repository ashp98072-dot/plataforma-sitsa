import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { validarOrigenCB2 } from "@/lib/flota/cb2/origin";
import { bodyAcotado } from "@/lib/flota/cb2/http";
import { ErrorCB2 } from "@/lib/flota/cb2/model";
import { listarPlacas, revocarPlaca } from "@/lib/flota/cb2/placas-equivalencias";

export const runtime = "nodejs";
const op = z.object({ proveedorId: z.number().int().positive(), placaHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();
const headers = { "Cache-Control": "private, no-store" };
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const g = await requireTenantFlotaCombustible((await ctx.params).slug, "ver", { soloLectura: true });
  if (g.error) return g.error;
  try { return NextResponse.json(await listarPlacas(g.empresa.id), { headers }); }
  catch { return NextResponse.json({ error: "No se pudieron consultar las equivalencias." }, { status: 500, headers }); }
}
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const slug = (await ctx.params).slug;
  const g = await requireTenantFlotaCombustible(slug, "conciliar");
  if (g.error) return g.error;
  try {
    if (g.session.rol !== "Admin") throw new ErrorCB2("Revocar requiere Admin.", 403);
    validarOrigenCB2(req);
    const entrada = op.parse(JSON.parse((await bodyAcotado(req, 4096)).toString("utf8")));
    const autorizar = async () => { const actual = await requireTenantFlotaCombustible(slug, "conciliar"); if (actual.error || actual.session.id !== g.session.id || actual.empresa.id !== g.empresa.id || actual.session.rol !== "Admin") throw new ErrorCB2("Autorización cambió.", 403); };
    return NextResponse.json(await revocarPlaca({ empresaId: g.empresa.id, proveedorId: entrada.proveedorId, actor: { id: g.session.id, username: g.session.username }, autorizar }, entrada.placaHash), { headers });
  } catch (e) { return NextResponse.json({ error: e instanceof ErrorCB2 ? e.message : "No se pudo revocar la equivalencia." }, { status: e instanceof ErrorCB2 ? e.status : e instanceof z.ZodError || e instanceof SyntaxError ? 400 : 500, headers }); }
}

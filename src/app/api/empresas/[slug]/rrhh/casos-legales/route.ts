import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { casoSchema, seguimientoSchema, consultarCasos, guardarCaso, ErrorCaso } from "@/lib/rrhh/casos-legales";
type Ctx = { params: Promise<{ slug: string }> };
function fallo(error: unknown) {
  if (error instanceof ErrorCaso) return NextResponse.json({ error: error.message }, { status: error.status });
  if ((error as { code?: string })?.code === "ER_NO_SUCH_TABLE") return NextResponse.json({ error: "Casos legales pendiente de habilitar: aplicar la migración manual de casos legales. La bitácora histórica sigue disponible." }, { status: 503 });
  return NextResponse.json({ error: "No se pudo completar la operación de casos legales." }, { status: 500 });
}
export async function GET(req: Request, ctx: Ctx) {
  const guard = await requireTenantRrhh((await ctx.params).slug, "bitacora_legal", "ver");
  if (guard.error) return guard.error;
  const params = new URL(req.url).searchParams;
  const id = params.has("id") ? Number(params.get("id")) : undefined;
  const pagina = Number(params.get("pagina") ?? 1);
  if ((id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) || !Number.isSafeInteger(pagina) || pagina < 1 || pagina > 10000) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  try {
    const datos = await consultarCasos(guard.empresa.id, id, pagina);
    const editar = await requireTenantRrhh((await ctx.params).slug, "bitacora_legal", "editar");
    return NextResponse.json({ ...datos, puedeEditar: !editar.error });
  }
  catch (error) { return fallo(error); }
}
async function escribir(req: Request, ctx: Ctx, seguimiento: boolean) {
  const guard = await requireTenantRrhh((await ctx.params).slug, "bitacora_legal", "editar");
  if (guard.error) return guard.error;
  const parsed = (seguimiento ? seguimientoSchema : casoSchema).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  try { return NextResponse.json(await guardarCaso(guard.empresa.id, guard.session.username, parsed.data)); }
  catch (error) { return fallo(error); }
}
export const POST = (req: Request, ctx: Ctx) => escribir(req, ctx, false);
export const PATCH = (req: Request, ctx: Ctx) => escribir(req, ctx, true);

import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { listarEntidades } from "@/lib/contabilidad/entidades";
import { AccesoContable, ambitoDesdeRequest } from "@/lib/contabilidad/ambito";
import { consultarBancos } from "@/lib/contabilidad/bancos";

const headers = { "Cache-Control": "private, no-store" };
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) { guard.error.headers.set("Cache-Control", headers["Cache-Control"]); return guard.error; }
  try {
    const params = new URL(req.url).searchParams;
    for (const key of params.keys()) if (key !== "entidad") throw new AccesoContable("Parámetro no admitido.", 400);
    if (!params.has("entidad")) return NextResponse.json({ entidades: await listarEntidades(guard.empresa.id, guard.session.rol === "Admin") }, { headers });
    const bancos = await consultarBancos(guard.empresa.id, ambitoDesdeRequest(req, guard.session));
    return NextResponse.json({ bancos }, { headers });
  } catch (e) {
    if (e instanceof AccesoContable) return NextResponse.json({ error: e.message }, { status: e.status, headers });
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(String((e as { code?: string }).code))) {
      return NextResponse.json({ error: "Catálogo bancario no disponible: revisa las migraciones de entidades, cuentas y FACT-4 con el administrador.", codigo: "MIGRACION_PENDIENTE" }, { status: 503, headers });
    }
    return NextResponse.json({ error: "No se pudo consultar el catálogo bancario." }, { status: 500, headers });
  }
}

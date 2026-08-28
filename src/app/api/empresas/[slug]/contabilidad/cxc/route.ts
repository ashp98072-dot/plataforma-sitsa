import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { crearRegistro, errorRegistro } from "@/lib/contabilidad/registros";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) return guard.error;
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT * FROM cont_cxc WHERE empresa_id = ? ORDER BY fecha DESC LIMIT 200",
      [guard.empresa.id],
    );
    return NextResponse.json({ cxc: rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo consultar el listado." }, { status: 500 });
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad", true);
  if (guard.error) return guard.error;
  const body = await req.json().catch(() => null);
  try {
    const id = await crearRegistro("cxc", guard.empresa.id, guard.session.username, body);
    return NextResponse.json({ id, mensaje: "CxC registrada." });
  } catch (error) { return errorRegistro(error); }
}

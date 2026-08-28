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
      "SELECT id, codigo, nombre, tipo, nivel, activa FROM cont_cuentas WHERE empresa_id = ? ORDER BY codigo",
      [guard.empresa.id],
    );
    return NextResponse.json({ cuentas: rows }, { headers: { "Cache-Control": "private, no-store" } });
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
    const id = await crearRegistro("cuentas", guard.empresa.id, guard.session.username, body);
    return NextResponse.json({ id, mensaje: "Cuenta creada." });
  } catch (error) { return errorRegistro(error); }
}

import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantFacturacion } from "@/lib/tenant";

/** Catálogo mínimo de facturas; no expone cuestionarios ni concede su administración. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "ver");
  if (guard.error) return guard.error;
  const rows = await query<RowDataPacket[]>(
    "SELECT id, nombre FROM clientes WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre",
    [guard.empresa.id],
  );
  return NextResponse.json({ clientes: rows.map(r => ({ clienteId: Number(r.id), nombre: String(r.nombre) })) },
    { headers: { "Cache-Control": "private, no-store" } });
}

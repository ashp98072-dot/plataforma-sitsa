import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";
import { AsientoInvalido, registrarAsiento } from "@/lib/contabilidad/asientos";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) return guard.error;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, fecha, numero, glosa, estado, creado_por
     FROM cont_asientos WHERE empresa_id = ? ORDER BY fecha DESC, id DESC LIMIT 100`,
    [guard.empresa.id],
  );
  return NextResponse.json({ asientos: rows });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad", true);
  if (guard.error) return guard.error;
  const body = await req.json().catch(() => null);
  try {
    const id = await registrarAsiento(guard.empresa.id, guard.session.username, body);
    return NextResponse.json({ id, mensaje: "Asiento registrado." });
  } catch (error) {
    if (error instanceof AsientoInvalido) return NextResponse.json({ error: error.message }, { status: 400 });
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") return NextResponse.json({ error: "Ya existe un asiento con ese número en esta empresa." }, { status: 409 });
    if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") return NextResponse.json({ error: "Otra operación está modificando estas cuentas. Intenta nuevamente." }, { status: 409 });
    console.error("Registro de asiento contable fallido", { code: code ?? "desconocido" });
    return NextResponse.json({ error: "No se pudo confirmar el registro. Consulta los asientos antes de reintentar." }, { status: 500 });
  }
}

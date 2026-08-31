import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { AsientoInvalido, registrarAsiento } from "@/lib/contabilidad/asientos";
import { consultarPartida } from "@/lib/contabilidad/consulta-partida";

import { ambitoDesdeRequest, consultarLibro, errorAmbito } from "@/lib/contabilidad/ambito";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "contabilidad");
  if (guard.error) return guard.error;
  try {
    const ids = new URL(req.url).searchParams.getAll("id");
    if (ids.length > 1) return NextResponse.json({ error: "Partida inválida." }, { status: 400 });
    if (ids.length === 1) {
      const detalle = await consultarPartida(guard.empresa.id, ambitoDesdeRequest(req, guard.session), ids[0]);
      return NextResponse.json(detalle, { headers: { "Cache-Control": "private, no-store" } });
    }
    const rows = await consultarLibro("asientos", guard.empresa.id, ambitoDesdeRequest(req, guard.session));
    return NextResponse.json({ asientos: rows }, { headers: { "Cache-Control": "private, no-store" } });
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
    const id = await registrarAsiento(guard.empresa.id, guard.session.username, body, ambitoDesdeRequest(req, guard.session));
    return NextResponse.json({ id, mensaje: "Asiento registrado." });
  } catch (error) {
    const acceso = errorAmbito(error);
    if (acceso) return acceso;
    if (error instanceof AsientoInvalido) return NextResponse.json({ error: error.message }, { status: 400 });
    const code = (error as { code?: string })?.code;
    if (code === "ER_DUP_ENTRY") return NextResponse.json({ error: "Número duplicado. Si pertenece a otra entidad, verifica la migración C2B." }, { status: 409 });
    if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") return NextResponse.json({ error: "Otra operación está modificando estas cuentas. Intenta nuevamente." }, { status: 409 });
    console.error("Registro de asiento contable fallido", { code: code ?? "desconocido" });
    return NextResponse.json({ error: "No se pudo confirmar el registro. Consulta los asientos antes de reintentar." }, { status: 500 });
  }
}

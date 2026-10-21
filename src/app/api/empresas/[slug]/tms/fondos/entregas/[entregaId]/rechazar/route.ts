import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { rechazarRecepcion } from "@/lib/entregas/entregas";
import { cargarEntregaDeModulo, conReintentoPorDeadlock, idDeRuta, respuestaFalloOperacion, respuestaNoEncontrada } from "@/lib/entregas/http";
import { aDto } from "@/lib/entregas/presentacion";

type Ctx = { params: Promise<{ slug: string; entregaId: string }> };

/** Rechazar la recepción (JSON `{ motivo }`, obligatorio). Solo el receptor del área destino, nunca el emisor (lo decide el servicio). */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, entregaId: idRuta } = await ctx.params;
    const guard = await requireTenantEntregas(slug);
    if (guard.error) return guard.error;
    const entregaId = idDeRuta(idRuta);
    if (!entregaId || !(await cargarEntregaDeModulo(guard.empresa.id, entregaId, "FONDOS"))) return respuestaNoEncontrada();

    const body = (await req.json().catch(() => ({}))) as { motivo?: unknown };
    const entrega = await conReintentoPorDeadlock(() => rechazarRecepcion({
      empresaId: guard.empresa.id,
      actor: guard.actor,
      entregaId,
      motivo: typeof body.motivo === "string" ? body.motivo : "",
    }));
    return NextResponse.json({ mensaje: "Entrega rechazada.", entrega: aDto(entrega, guard.actor) });
  } catch (error) {
    return respuestaFalloOperacion(error, "POST tms/fondos/entregas/[entregaId]/rechazar");
  }
}

import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { confirmarRecepcion } from "@/lib/entregas/entregas";
import { cargarEntregaDeModulo, conReintentoPorDeadlock, idDeRuta, leerFirmaFormulario, respuestaFalloOperacion, respuestaNoEncontrada, texto } from "@/lib/entregas/http";
import { aDto } from "@/lib/entregas/presentacion";

type Ctx = { params: Promise<{ slug: string; entregaId: string }> };

/** Confirmar recepción (multipart: `firmaImagen` | `usarFirmaGuardada`, `observaciones`). Firma obligatoria; lo demás lo decide `confirmarRecepcion`. */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, entregaId: idRuta } = await ctx.params;
    const guard = await requireTenantEntregas(slug);
    if (guard.error) return guard.error;
    const entregaId = idDeRuta(idRuta);
    if (!entregaId || !(await cargarEntregaDeModulo(guard.empresa.id, entregaId, "FONDOS"))) return respuestaNoEncontrada();

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    const { firma } = await leerFirmaFormulario(form, guard.session.id);

    const entrega = await conReintentoPorDeadlock(() => confirmarRecepcion({
      empresaId: guard.empresa.id,
      actor: guard.actor,
      entregaId,
      observaciones: texto(form, "observaciones"),
      firma,
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    }));
    return NextResponse.json({ mensaje: "Recepción registrada.", entrega: aDto(entrega, guard.actor) });
  } catch (error) {
    return respuestaFalloOperacion(error, "POST tms/fondos/entregas/[entregaId]/recibir");
  }
}

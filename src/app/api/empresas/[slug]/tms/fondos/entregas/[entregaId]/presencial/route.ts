import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { registrarRecepcionPresencial } from "@/lib/entregas/entregas";
import { cargarEntregaDeModulo, conReintentoPorDeadlock, idDeRuta, leerFirmaFormulario, respuestaFalloOperacion, respuestaNoEncontrada, texto } from "@/lib/entregas/http";
import { aDto } from "@/lib/entregas/presentacion";

type Ctx = { params: Promise<{ slug: string; entregaId: string }> };

/**
 * Recepción presencial (multipart): `nombreReceptor`, `observaciones` y `firmaImagen` DIBUJADA (la firma guardada no se acepta:
 * quien recibe no tiene usuario). El usuario que opera el dispositivo sale de la sesión. Sin documento de identidad.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, entregaId: idRuta } = await ctx.params;
    const guard = await requireTenantEntregas(slug);
    if (guard.error) return guard.error;
    const entregaId = idDeRuta(idRuta);
    if (!entregaId || !(await cargarEntregaDeModulo(guard.empresa.id, entregaId, "FONDOS"))) return respuestaNoEncontrada();

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    const { firma } = await leerFirmaFormulario(form, guard.session.id, true);

    const entrega = await conReintentoPorDeadlock(() => registrarRecepcionPresencial({
      empresaId: guard.empresa.id,
      actor: guard.actor,
      entregaId,
      nombreReceptor: texto(form, "nombreReceptor") ?? "",
      observaciones: texto(form, "observaciones"),
      firma,
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    }));
    return NextResponse.json({ mensaje: "Recepción presencial registrada.", entrega: aDto(entrega, guard.actor) });
  } catch (error) {
    return respuestaFalloOperacion(error, "POST tms/fondos/entregas/[entregaId]/presencial");
  }
}

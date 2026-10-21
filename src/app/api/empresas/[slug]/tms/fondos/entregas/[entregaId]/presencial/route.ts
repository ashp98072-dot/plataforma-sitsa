import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { MENSAJES_ENTREGA, registrarRecepcionPresencial, type EvidenciaEntregaInput, type FirmaEntregaInput } from "@/lib/entregas/entregas";
import { MAX_EVIDENCIA_BYTES, MENSAJE_EVIDENCIA_INVALIDA } from "@/lib/entregas/evidencia";
import {
  cargarEntregaDeModulo, conReintentoPorDeadlock, idDeRuta, leerFirmaFormulario, respuestaFalloOperacion, respuestaNoEncontrada, texto,
} from "@/lib/entregas/http";
import { aDto } from "@/lib/entregas/presentacion";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";

type Ctx = { params: Promise<{ slug: string; entregaId: string }> };

/**
 * Recepción presencial (multipart): `nombreReceptor`, `observaciones` y la evidencia, que es UNA de:
 *   - `evidencia`: la constancia impresa, firmada a mano y escaneada (PDF/JPG/PNG de hasta 10 MB) — forma principal;
 *   - `firmaImagen`: firma DIBUJADA por quien recibe en el dispositivo — alternativa (la firma guardada no se acepta: quien
 *     recibe no tiene usuario).
 * El usuario que opera el sistema sale de la sesión; sin documento de identidad. El formato real del archivo (magic bytes), su
 * tamaño, la empresa, los permisos y el estado los valida el servicio común.
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

    let evidencia: EvidenciaEntregaInput | null = null;
    const archivo = form.get("evidencia");
    if (archivo instanceof File && archivo.size > 0) {
      // Corte temprano por tamaño: no se lee a memoria un archivo enorme.
      if (archivo.size > MAX_EVIDENCIA_BYTES) throw new ErrorDominioFormulario(MENSAJE_EVIDENCIA_INVALIDA, 400);
      evidencia = { bytes: await archivo.arrayBuffer(), original: archivo.name || "constancia-firmada" };
    }
    let firma: FirmaEntregaInput | null = null;
    if (form.get("firmaImagen") instanceof File || form.get("usarFirmaGuardada") === "true") {
      firma = (await leerFirmaFormulario(form, guard.session.id, true)).firma;
    }
    if (!evidencia && !firma) throw new ErrorDominioFormulario(MENSAJES_ENTREGA.evidenciaRequerida, 400);

    const entrega = await conReintentoPorDeadlock(() => registrarRecepcionPresencial({
      empresaId: guard.empresa.id,
      actor: guard.actor,
      entregaId,
      nombreReceptor: texto(form, "nombreReceptor") ?? "",
      observaciones: texto(form, "observaciones"),
      evidencia,
      firma,
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    }));
    return NextResponse.json({
      mensaje: "Recepción presencial registrada.",
      entrega: aDto(entrega, guard.actor, { tieneEvidencia: evidencia !== null }),
    });
  } catch (error) {
    return respuestaFalloOperacion(error, "POST tms/fondos/entregas/[entregaId]/presencial");
  }
}

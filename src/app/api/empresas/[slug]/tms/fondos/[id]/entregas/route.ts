import { NextResponse } from "next/server";
import { requireTenantEntregas } from "@/lib/tenant";
import { leerDocumento } from "@/lib/entregas/adaptadores";
import { ETIQUETA_AREA, type AreaEntrega, type ModoEntrega } from "@/lib/entregas/catalogo";
import { listarEntregasDocumento, registrarEntrega } from "@/lib/entregas/entregas";
import { conReintentoPorDeadlock, idDeRuta, leerFirmaFormulario, respuestaFalloOperacion, respuestaNoEncontrada, texto } from "@/lib/entregas/http";
import { idsConEvidencia } from "@/lib/entregas/evidencia";
import { aDto, opcionesRegistro } from "@/lib/entregas/presentacion";
import { calcularCustodia } from "@/lib/entregas/reglas";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const NO_ENCONTRADA = "Solicitud no encontrada.";

/**
 * CONTROL DE ENTREGA — historial de entregas de UNA solicitud de fondo + custodia actual + opciones de «Registrar entrega» para el
 * usuario de la sesión. Empresa y actor salen SIEMPRE de la sesión; una solicitud de otra empresa responde 404 igual que una
 * inexistente.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { slug, id: idRuta } = await ctx.params;
    const guard = await requireTenantEntregas(slug, { aceptaGastosVer: true });
    if (guard.error) return guard.error;
    const id = idDeRuta(idRuta);
    if (!id) return respuestaNoEncontrada(NO_ENCONTRADA);

    const documento = await leerDocumento(guard.empresa.id, "FONDOS", id);
    if (!documento) return respuestaNoEncontrada(NO_ENCONTRADA);

    const entregas = await listarEntregasDocumento(guard.empresa.id, "FONDOS", id);
    const { area, pendiente } = calcularCustodia("FONDOS", entregas);
    // Constancias escaneadas adjuntas (solo recepciones presenciales): una consulta para todo el historial.
    const conEvidencia = await idsConEvidencia(guard.empresa.id, entregas.filter((e) => e.estado === "RECIBIDA" && e.modo === "PRESENCIAL").map((e) => e.id));
    return NextResponse.json({
      documento: { codigo: documento.codigo, estado: documento.estado },
      custodia: { area, etiqueta: ETIQUETA_AREA[area] },
      pendiente: pendiente ? aDto(pendiente, guard.actor) : null,
      entregas: entregas.map((e) => aDto(e, guard.actor, { tieneEvidencia: conEvidencia.has(e.id) })),
      registrar: opcionesRegistro(guard.actor, "FONDOS", area, Boolean(pendiente), documento.estado),
    });
  } catch (error) {
    return respuestaFalloOperacion(error, "GET tms/fondos/[id]/entregas");
  }
}

/**
 * «Registrar entrega» (multipart/form-data): `destino`, `modo` (SISTEMA|PRESENCIAL), `observaciones`, `claveIdempotencia`
 * y la firma (`firmaImagen` dibujada o `usarFirmaGuardada=true`). Todo lo demás (origen = custodia, permisos por área,
 * `entregas_presencial`, estado del documento, una sola pendiente, idempotencia) lo decide `registrarEntrega`.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    const { slug, id: idRuta } = await ctx.params;
    const guard = await requireTenantEntregas(slug);
    if (guard.error) return guard.error;
    const id = idDeRuta(idRuta);
    if (!id) return respuestaNoEncontrada(NO_ENCONTRADA);

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
    const { firma } = await leerFirmaFormulario(form, guard.session.id);

    const r = await conReintentoPorDeadlock(() => registrarEntrega({
      empresaId: guard.empresa.id,
      actor: guard.actor,
      modulo: "FONDOS",
      entidadId: id,
      destino: (texto(form, "destino") ?? "") as AreaEntrega,
      modo: (texto(form, "modo") ?? "SISTEMA") as ModoEntrega,
      observaciones: texto(form, "observaciones"),
      claveIdempotencia: texto(form, "claveIdempotencia") ?? "",
      firma,
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    }));
    return NextResponse.json(
      { mensaje: r.repetida ? "La entrega ya estaba registrada." : "Entrega registrada.", repetida: r.repetida, entrega: aDto(r.entrega, guard.actor) },
      { status: r.repetida ? 200 : 201 },
    );
  } catch (error) {
    return respuestaFalloOperacion(error, "POST tms/fondos/[id]/entregas");
  }
}

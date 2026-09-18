import { NextResponse } from "next/server";
import { requireComprasAutorizar } from "./acceso";
import { cambiarEstadoRequerimientoSchema } from "./requerimiento-schema";
import { autorizarRequerimientoCompra, ErrorCompra, rechazarRequerimientoCompra } from "./requerimientos";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";

/**
 * COMPRAS-FASE-4-AUTORIZACION — POST .../requerimientos/[id]/estado.
 * Endpoint específico y separado de requerimientoGuardar() (a propósito:
 * autorizar/rechazar es una decisión, no una edición de datos de la
 * línea/cabecera). Gate exclusivo: compras_autorizar:editar — NUNCA
 * compras_requerimientos:editar, tms:editar ni compras_proveedores:editar.
 *
 * La identidad de quien autoriza/rechaza SIEMPRE viene de `guard.session`
 * — el body solo admite accion/version/motivo (cambiarEstadoRequerimientoSchema
 * es `.strict()`, rechaza cualquier otro campo, incluido un eventual
 * autorizante_usuario_id/autorizante_nombre falsificado por el cliente).
 */
const respuesta = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const idValido = (id: string) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647;
function fallo(error: unknown) {
  return error instanceof ErrorCompra
    ? respuesta({ error: error.message }, error.status)
    : respuesta({ error: "No se pudo procesar la decisión." }, 500);
}

export async function requerimientoEstadoCambiar(req: Request, slug: string, rawId: string) {
  const guard = await requireComprasAutorizar(slug, "editar");
  if (guard.error) {
    guard.error.headers.set("Cache-Control", "private, no-store");
    return guard.error;
  }
  if (!idValido(rawId)) return respuesta({ error: "Requerimiento no encontrado." }, 404);
  const id = Number(rawId);

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return respuesta({ error: "JSON no válido." }, 400);
  }
  const datos = cambiarEstadoRequerimientoSchema.safeParse(payload);
  if (!datos.success) {
    const erroresCampos = Object.fromEntries(
      datos.error.issues.map((i) => [
        i.path.join(".") || "formulario",
        i.code === "unrecognized_keys" ? "El formulario contiene campos no permitidos." : i.message,
      ]),
    );
    return respuesta({ error: Object.values(erroresCampos)[0], erroresCampos }, 400);
  }

  try {
    if (datos.data.accion === "autorizar") {
      // Mismo patrón exacto que fondos/[id]/route.ts y
      // gastos/[id]/autorizar/route.ts: leer la firma ANTES de tocar la
      // base de datos — si no hay firma guardada, 400 funcional, sin
      // abrir ninguna transacción.
      const firmaImagen = await leerBytesFirmaGuardada(guard.session.id);
      const requerimiento = await autorizarRequerimientoCompra(guard.empresa.id, id, datos.data.version, {
        usuario: guard.session.username,
        autorizanteUsuarioId: guard.session.id,
        autorizanteNombre: guard.session.nombre || guard.session.username,
        autorizanteRol: guard.session.rol ?? null,
        firmaImagen,
      });
      if (!requerimiento) return respuesta({ error: "Requerimiento no encontrado." }, 404);
      return respuesta({ mensaje: "Requerimiento autorizado.", requerimiento });
    }
    const requerimiento = await rechazarRequerimientoCompra(guard.empresa.id, id, datos.data.version, {
      usuario: guard.session.username,
      usuarioId: guard.session.id,
      motivo: datos.data.motivo,
    });
    if (!requerimiento) return respuesta({ error: "Requerimiento no encontrado." }, 404);
    return respuesta({ mensaje: "Requerimiento rechazado.", requerimiento });
  } catch (error) {
    return fallo(error);
  }
}

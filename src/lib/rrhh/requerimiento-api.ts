import { NextResponse } from "next/server";
import { requireRrhhRequerimientos, requireRrhhRequerimientosAutorizar } from "./requerimiento-acceso";
import { cambiarEstadoRequerimientoRrhhSchema, crearRequerimientoRrhhSchema, editarRequerimientoRrhhSchema, filtrosRequerimientoRrhhSchema } from "./requerimiento-schema";
import {
  autorizarRequerimientoRrhh, catalogosRequerimientoRrhh, ErrorRequerimientoRrhh, guardarRequerimientoRrhh,
  listarRequerimientosRrhh, obtenerRequerimientoRrhh, rechazarRequerimientoRrhh,
} from "./requerimientos";

/** RRHH-REQUERIMIENTOS-PROVEEDORES-1 — mismo patrón exacto que src/lib/compras/requerimiento-api.ts, guards propios de RRHH. */
const respuesta = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const idValido = (id: string) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647;
function fallo(error: unknown) {
  return error instanceof ErrorRequerimientoRrhh ? respuesta({ error: error.message }, error.status) : respuesta({ error: "No se pudo procesar el requerimiento." }, 500);
}

export async function requerimientoRrhhGet(req: Request, slug: string, rawId?: string) {
  const guard = await requireRrhhRequerimientos(slug, "ver");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  if (rawId !== undefined && !idValido(rawId)) return respuesta({ error: "Requerimiento no encontrado." }, 404);
  try {
    if (rawId !== undefined) {
      const requerimiento = await obtenerRequerimientoRrhh(guard.empresa.id, Number(rawId));
      return requerimiento ? respuesta({ requerimiento }) : respuesta({ error: "Requerimiento no encontrado." }, 404);
    }
    const valores = Object.fromEntries(new URL(req.url).searchParams);
    const filtros = filtrosRequerimientoRrhhSchema.safeParse(valores);
    if (!filtros.success) return respuesta({ error: "Los filtros no son válidos." }, 400);
    return respuesta({ requerimientos: await listarRequerimientosRrhh(guard.empresa.id, filtros.data) });
  } catch (error) { return fallo(error); }
}

export async function requerimientoRrhhGuardar(req: Request, slug: string, rawId?: string) {
  const guard = await requireRrhhRequerimientos(slug, rawId === undefined ? "crear" : "editar");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  if (rawId !== undefined && !idValido(rawId)) return respuesta({ error: "Requerimiento no encontrado." }, 404);
  let payload: unknown;
  try { payload = await req.json(); } catch { return respuesta({ error: "JSON no válido." }, 400); }
  const datos = (rawId === undefined ? crearRequerimientoRrhhSchema : editarRequerimientoRrhhSchema).safeParse(payload);
  if (!datos.success) {
    const erroresCampos = Object.fromEntries(datos.error.issues.map(i => [i.path.join(".") || "formulario", i.code === "unrecognized_keys" ? "El formulario contiene campos no permitidos." : i.message]));
    return respuesta({ error: Object.values(erroresCampos)[0], erroresCampos }, 400);
  }
  try {
    return respuesta(await guardarRequerimientoRrhh(guard.empresa.id, guard.session.id, guard.session.username, datos.data, rawId === undefined ? undefined : Number(rawId)),
      rawId === undefined ? 201 : 200);
  } catch (error) { return fallo(error); }
}

export async function requerimientoRrhhCatalogosGet(slug: string) {
  const guard = await requireRrhhRequerimientos(slug, "ver");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  try { return respuesta(await catalogosRequerimientoRrhh(guard.empresa.id)); } catch (error) { return fallo(error); }
}

/**
 * POST .../requerimientos/[id]/estado. Identidad de quien autoriza/rechaza SIEMPRE desde `guard.session` — el body
 * solo admite accion/version/motivo (schema `.strict()`, rechaza cualquier autorizante_usuario_id/nombre del cliente).
 */
export async function requerimientoRrhhEstadoCambiar(req: Request, slug: string, rawId: string) {
  const guard = await requireRrhhRequerimientosAutorizar(slug);
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  if (!idValido(rawId)) return respuesta({ error: "Requerimiento no encontrado." }, 404);
  const id = Number(rawId);
  let payload: unknown;
  try { payload = await req.json(); } catch { return respuesta({ error: "JSON no válido." }, 400); }
  const datos = cambiarEstadoRequerimientoRrhhSchema.safeParse(payload);
  if (!datos.success) {
    const erroresCampos = Object.fromEntries(datos.error.issues.map(i => [i.path.join(".") || "formulario", i.code === "unrecognized_keys" ? "El formulario contiene campos no permitidos." : i.message]));
    return respuesta({ error: Object.values(erroresCampos)[0], erroresCampos }, 400);
  }
  try {
    const resultado = datos.data.accion === "autorizar"
      ? await autorizarRequerimientoRrhh(guard.empresa.id, id, datos.data.version, { usuario: guard.session.username, autorizanteUsuarioId: guard.session.id, autorizanteNombre: guard.session.nombre || guard.session.username })
      : await rechazarRequerimientoRrhh(guard.empresa.id, id, datos.data.version, { usuario: guard.session.username, usuarioId: guard.session.id, motivo: datos.data.motivo });
    return resultado ? respuesta({ requerimiento: resultado }) : respuesta({ error: "Requerimiento no encontrado." }, 404);
  } catch (error) { return fallo(error); }
}

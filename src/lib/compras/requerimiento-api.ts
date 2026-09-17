import { NextResponse } from "next/server";
import { tienePermiso } from "@/lib/permisos-shared";
import { requireComprasCatalogos, requireComprasRequerimientos } from "./acceso";
import { crearRequerimientoSchema, editarRequerimientoSchema, filtrosCompraSchema } from "./requerimiento-schema";
import { catalogosCompra, ErrorCompra, guardarRequerimiento, listarRequerimientos, obtenerRequerimiento } from "./requerimientos";

const respuesta = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const idValido = (id: string) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647;
function fallo(error: unknown) {
  return error instanceof ErrorCompra ? respuesta({ error: error.message }, error.status) : respuesta({ error: "No se pudo procesar el requerimiento." }, 500);
}
export async function requerimientoGet(req: Request, slug: string, rawId?: string) {
  const guard = await requireComprasRequerimientos(slug, "ver");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  if (rawId !== undefined && !idValido(rawId)) return respuesta({ error: "Requerimiento no encontrado." }, 404);
  try {
    if (rawId !== undefined) {
      const requerimiento = await obtenerRequerimiento(guard.empresa.id, Number(rawId));
      return requerimiento ? respuesta({ requerimiento }) : respuesta({ error: "Requerimiento no encontrado." }, 404);
    }
    const valores = Object.fromEntries(new URL(req.url).searchParams);
    const filtros = filtrosCompraSchema.safeParse(valores);
    if (!filtros.success) return respuesta({ error: "Los filtros no son válidos." }, 400);
    return respuesta({ requerimientos: await listarRequerimientos(guard.empresa.id, filtros.data) });
  } catch (error) { return fallo(error); }
}
export async function requerimientoGuardar(req: Request, slug: string, rawId?: string) {
  const guard = await requireComprasRequerimientos(slug, rawId === undefined ? "crear" : "editar");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  if (rawId !== undefined && !idValido(rawId)) return respuesta({ error: "Requerimiento no encontrado." }, 404);
  let payload: unknown;
  try { payload = await req.json(); } catch { return respuesta({ error: "JSON no válido." }, 400); }
  const datos = (rawId === undefined ? crearRequerimientoSchema : editarRequerimientoSchema).safeParse(payload);
  if (!datos.success) {
    const erroresCampos = Object.fromEntries(datos.error.issues.map(i => [i.path.join(".") || "formulario", i.code === "unrecognized_keys" ? "El formulario contiene campos no permitidos." : i.message]));
    return respuesta({ error: Object.values(erroresCampos)[0], erroresCampos }, 400);
  }
  try {
    return respuesta(await guardarRequerimiento(guard.empresa.id, guard.session.id, guard.session.username, datos.data,
      tienePermiso(guard.permisos, "compras_requerimientos", "eliminar"), rawId === undefined ? undefined : Number(rawId)), rawId === undefined ? 201 : 200);
  } catch (error) { return fallo(error); }
}
export async function comprasCatalogosGet(slug: string) {
  const guard = await requireComprasCatalogos(slug);
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  try { return respuesta(await catalogosCompra(guard.empresa.id)); } catch (error) { return fallo(error); }
}

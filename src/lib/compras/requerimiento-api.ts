import type { RowDataPacket } from "mysql2";
import { NextResponse } from "next/server";
import { tienePermiso } from "@/lib/permisos-shared";
import { requireComprasCatalogos, requireComprasRequerimientos } from "./acceso";
import { crearRequerimientoSchema, editarRequerimientoSchema, filtrosCompraSchema } from "./requerimiento-schema";
import { catalogosCompra, ErrorCompra, guardarRequerimiento, listarRequerimientos, obtenerRequerimiento } from "./requerimientos";
import { query } from "@/lib/db";
import { buscarFacturaExistente } from "./facturas-duplicadas";

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

/**
 * GET .../requerimientos/facturas/verificar?proveedorId&serie&numero[&lineaId][&requerimientoId] — consulta LIVIANA de UX mientras
 * se escribe el formulario. La empresa SIEMPRE sale de la sesión (nunca de la consulta). Sin número no hay control ({ existe:false }).
 * `lineaId` excluye SOLO esa línea (al editar no se detecta a sí misma; otra línea del mismo requerimiento sí cuenta).
 * Solo lectura; el guardado vuelve a validar todo en el servidor (esto no es la autoridad).
 */
export async function facturaVerificarGet(req: Request, slug: string) {
  const guard = await requireComprasRequerimientos(slug, "ver");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  const sp = new URL(req.url).searchParams;
  const entero = (v: string | null) => (v !== null && idValido(v) ? Number(v) : null);
  const proveedorId = entero(sp.get("proveedorId"));
  if (proveedorId === null) return respuesta({ error: "Proveedor no válido." }, 400);
  for (const c of ["lineaId", "requerimientoId"]) if (sp.get(c) !== null && entero(sp.get(c)) === null) return respuesta({ error: "Parámetros no válidos." }, 400);
  const serie = sp.get("serie") ?? "";
  const numero = sp.get("numero") ?? "";
  if (serie.length > 100 || numero.length > 100) return respuesta({ error: "Serie o número demasiado largos." }, 400);
  try {
    const factura = await buscarFacturaExistente(async (sql, params) => query<RowDataPacket[]>(sql, params as never), guard.empresa.id, proveedorId, serie, numero,
      { excluirLineaId: entero(sp.get("lineaId")) ?? undefined });
    return respuesta(factura ? { existe: true, factura } : { existe: false });
  } catch (error) { return fallo(error); }
}

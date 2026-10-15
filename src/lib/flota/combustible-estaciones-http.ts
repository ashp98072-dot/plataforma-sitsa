import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { estacionSchema, estacionPatchSchema, guardarEstacion, listarEstaciones } from "./combustible-estaciones";

export async function estacionesGet(req: Request, slug: string) {
  const guard = await requireTenantFlotaCombustible(slug, "gestionar_estaciones");
  if (guard.error) return guard.error;
  const url = new URL(req.url), p = url.searchParams.get("proveedorId"), activo = url.searchParams.get("activo");
  if ((p && (!Number.isSafeInteger(Number(p)) || Number(p) <= 0)) || (activo && !["1", "0", "todos"].includes(activo))) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  return NextResponse.json({ items: await listarEstaciones(guard.empresa.id, { proveedorId: p ? Number(p) : undefined, buscar: (url.searchParams.get("buscar") ?? "").trim().slice(0,200), activo: activo === "1" ? true : activo === "0" ? false : undefined }) }, { headers: { "Cache-Control": "private, no-store" } });
}
export async function estacionGuardar(req: Request, slug: string, id?: number) {
  const guard = await requireTenantFlotaCombustible(slug, "gestionar_estaciones");
  if (guard.error) return guard.error;
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = (id == null ? estacionSchema : estacionPatchSchema).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Revisa proveedor, nombre y datos de la estación." }, { status: 400 });
  try {
    const estacionId = await guardarEstacion(guard.empresa.id, { usuarioId: guard.session.id, username: guard.session.username }, parsed.data, id);
    return NextResponse.json({ id: estacionId }, { status: id == null ? 201 : 200 });
  } catch (e) {
    if (e instanceof ErrorDominioFormulario) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ZodError) return NextResponse.json({ error: "Datos de estación inválidos." }, { status: 400 });
    console.error("[combustible-estaciones] guardar", e);
    return NextResponse.json({ error: "No se pudo guardar la estación." }, { status: 500 });
  }
}

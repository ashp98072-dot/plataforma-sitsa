import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { estacionSchema, estacionPatchSchema, guardarEstacion, listarEstaciones, listarProveedoresActivos } from "./combustible-estaciones";

/** Errores de BD reconocibles que NO son un fallo genérico: se traducen a un mensaje accionable para el usuario. */
export function respuestaErrorBdEstacion(e: unknown): { status: number; error: string } | null {
  const err = e as { errno?: number; code?: string };
  if (err?.errno === 1146 || err?.code === "ER_NO_SUCH_TABLE" || err?.errno === 1054 || err?.code === "ER_BAD_FIELD_ERROR") {
    return { status: 503, error: "El catálogo de estaciones no está instalado completo en la base de datos (falta aplicar la migración de Estaciones de combustible). Avisa a Sistemas; no se guardó nada." };
  }
  if (err?.errno === 1452 || err?.code === "ER_NO_REFERENCED_ROW_2") return { status: 409, error: "El proveedor ya no es válido para esta empresa. Actualiza la pantalla y vuelve a intentar." };
  if (err?.errno === 1406 || err?.code === "ER_DATA_TOO_LONG") return { status: 400, error: "Algún dato de la estación excede el largo permitido (nombre 150, dirección 500)." };
  if (err?.errno === 4025 || err?.errno === 3819 || err?.code === "ER_CONSTRAINT_FAILED" || err?.code === "ER_CHECK_CONSTRAINT_VIOLATED") return { status: 400, error: "El nombre de la estación no puede estar vacío." };
  if (err?.errno === 1205 || err?.errno === 1213) return { status: 409, error: "Otro usuario está modificando este proveedor. Vuelve a intentar en unos segundos." };
  return null;
}

export async function estacionesGet(req: Request, slug: string) {
  const guard = await requireTenantFlotaCombustible(slug, "gestionar_estaciones");
  if (guard.error) return guard.error;
  const url = new URL(req.url), p = url.searchParams.get("proveedorId"), activo = url.searchParams.get("activo");
  if ((p && (!Number.isSafeInteger(Number(p)) || Number(p) <= 0)) || (activo && !["1", "0", "todos"].includes(activo))) return NextResponse.json({ error: "Filtro inválido." }, { status: 400 });
  try {
    // Los proveedores activos viajan con el listado: el mantenimiento no depende del catálogo de captura de vales (que exige «Ver»
    // y consulta vehículos); así un fallo ajeno al catálogo de estaciones nunca deja el selector de proveedor vacío en silencio.
    const [items, proveedores] = await Promise.all([
      listarEstaciones(guard.empresa.id, { proveedorId: p ? Number(p) : undefined, buscar: (url.searchParams.get("buscar") ?? "").trim().slice(0, 200), activo: activo === "1" ? true : activo === "0" ? false : undefined }),
      listarProveedoresActivos(guard.empresa.id),
    ]);
    return NextResponse.json({ items, proveedores }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    const conocido = respuestaErrorBdEstacion(e);
    if (conocido) return NextResponse.json({ error: conocido.error }, { status: conocido.status });
    const referencia = randomUUID().slice(0, 8);
    console.error(`[combustible-estaciones] listar ref=${referencia}`, e);
    return NextResponse.json({ error: `No se pudo cargar las estaciones. Referencia ${referencia}.` }, { status: 500 });
  }
}
export async function estacionGuardar(req: Request, slug: string, id?: number) {
  const guard = await requireTenantFlotaCombustible(slug, "gestionar_estaciones");
  if (guard.error) return guard.error;
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const body = await req.json().catch(() => null);
  const parsed = (id == null ? estacionSchema : estacionPatchSchema).safeParse(body);
  if (!parsed.success) {
    // Mensaje real de la validación (p. ej. «Indica el nombre de la estación.») en vez de un genérico.
    const faltaProveedor = parsed.error.issues.some(i => i.path[0] === "proveedorId");
    const detalle = parsed.error.issues.find(i => i.path[0] !== "proveedorId")?.message;
    return NextResponse.json({ error: faltaProveedor ? "Selecciona un proveedor." : detalle ?? "Revisa proveedor, nombre y datos de la estación." }, { status: 400 });
  }
  try {
    const estacionId = await guardarEstacion(guard.empresa.id, { usuarioId: guard.session.id, username: guard.session.username }, parsed.data, id);
    return NextResponse.json({ id: estacionId }, { status: id == null ? 201 : 200 });
  } catch (e) {
    if (e instanceof ErrorDominioFormulario) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof ZodError) return NextResponse.json({ error: e.issues[0]?.message ?? "Datos de estación inválidos." }, { status: 400 });
    const conocido = respuestaErrorBdEstacion(e);
    if (conocido) {
      console.error("[combustible-estaciones] guardar (error de BD reconocido)", (e as { code?: string })?.code, (e as { sqlMessage?: string })?.sqlMessage);
      return NextResponse.json({ error: conocido.error }, { status: conocido.status });
    }
    const referencia = randomUUID().slice(0, 8);
    console.error(`[combustible-estaciones] guardar ref=${referencia}`, e);
    return NextResponse.json({ error: `No se pudo guardar la estación. Referencia ${referencia} (indícala a Sistemas).` }, { status: 500 });
  }
}

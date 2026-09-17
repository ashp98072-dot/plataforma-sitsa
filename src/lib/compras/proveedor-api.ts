import { NextResponse } from "next/server";
import { requireComprasProveedores } from "./acceso";
import { crearProveedorSchema, editarProveedorSchema } from "./proveedor-schema";
import { guardarProveedor, listarProveedores, obtenerProveedor } from "./proveedores";

const idValido = (id: string) => /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) <= 2147483647;

export async function proveedorGet(req: Request, slug: string, rawId?: string) {
  const guard = await requireComprasProveedores(slug, "ver");
  if (guard.error) return guard.error;
  if (rawId !== undefined && !idValido(rawId)) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });
  try {
    const resultado = rawId === undefined
      ? await listarProveedores(guard.empresa.id, (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 250))
      : await obtenerProveedor(guard.empresa.id, Number(rawId));
    if (resultado === null) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });
    return NextResponse.json(rawId === undefined ? { proveedores: resultado } : { proveedor: resultado }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "No se pudieron consultar los proveedores." }, { status: 500 }); }
}
export async function proveedorGuardar(req: Request, slug: string, rawId?: string) {
  const guard = await requireComprasProveedores(slug, rawId === undefined ? "crear" : "editar");
  if (guard.error) return guard.error;
  if (rawId !== undefined && !idValido(rawId)) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });
  let payload: unknown;
  try { payload = await req.json(); }
  catch { return NextResponse.json({ error: "JSON no válido." }, { status: 400 }); }
  const parsed = (rawId === undefined ? crearProveedorSchema : editarProveedorSchema).safeParse(payload);
  if (!parsed.success) {
    const erroresCampos = Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0] ?? "formulario"), i.code === "unrecognized_keys" ? "El formulario contiene campos no permitidos." : i.message]));
    return NextResponse.json({ error: Object.values(erroresCampos)[0], erroresCampos }, { status: 400 });
  }
  try {
    const id = await guardarProveedor(guard.empresa.id, guard.session.id, guard.session.username, parsed.data, rawId === undefined ? undefined : Number(rawId));
    if (id === null) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });
    return NextResponse.json({ id, mensaje: "Proveedor guardado." }, { status: rawId === undefined ? 201 : 200 });
  } catch { return NextResponse.json({ error: "No se pudo guardar el proveedor." }, { status: 500 }); }
}

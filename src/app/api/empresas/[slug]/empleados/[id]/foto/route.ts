import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { registrarDocumento } from "@/lib/rrhh/documentos";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { MAX_FOTO_EMPLEADO, respuestaFotoEmpleado, tipoFotoEmpleado } from "@/lib/rrhh/foto-empleado";

type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  try {
    if (!await obtenerEmpleado(guard.empresa.id, id)) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    return await respuestaFotoEmpleado(guard.empresa.id, id);
  } catch (error) {
    console.error("GET foto empleado", error);
    return NextResponse.json({ error: "No se pudo consultar la fotografía." }, { status: 500 });
  }
}
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  // Mismos permisos que los documentos del expediente existente.
  let guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) guard = await requireTenantRrhh(slug, "empleados", "crear");
  if (guard.error) return guard.error;
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  let nuevaRuta: string | null = null;
  try {
    if (!await obtenerEmpleado(guard.empresa.id, id)) return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > MAX_FOTO_EMPLEADO)
      return NextResponse.json({ error: "Selecciona una foto JPG, PNG o WebP de hasta 5 MB." }, { status: 400 });
    const bytes = await file.arrayBuffer();
    const tipo = tipoFotoEmpleado(new Uint8Array(bytes));
    if (!tipo || bytes.byteLength > MAX_FOTO_EMPLEADO)
      return NextResponse.json({ error: "El archivo no es una fotografía JPG, PNG o WebP válida." }, { status: 400 });
    // Extensión basada en contenido, no en el nombre/MIME declarados por cliente.
    const ext = tipo === "image/jpeg" ? "jpg" : tipo === "image/png" ? "png" : "webp";
    const saved = await guardarUpload(guard.empresa.id, "documentos", `emp${id}_foto`, {
      name: `foto.${ext}`, size: bytes.byteLength, arrayBuffer: async () => bytes,
    });
    nuevaRuta = saved.relative;
    const docId = await registrarDocumento({ empresaId: guard.empresa.id, idEmpleado: id,
      tipoDocumento: "Foto", rutaArchivo: saved.relative, nombreOriginal: file.name.slice(0, 255), subidoPor: guard.session.username });
    nuevaRuta = null;
    return NextResponse.json({ id: docId, mensaje: "Fotografía guardada." }, { status: 201 });
  } catch (error) {
    if (nuevaRuta) borrarUpload(nuevaRuta);
    console.error("POST foto empleado", error);
    return NextResponse.json({ error: "No se pudo guardar la fotografía. Puedes intentarlo nuevamente." }, { status: 500 });
  }
}

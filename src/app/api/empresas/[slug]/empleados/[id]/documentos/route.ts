import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import {
  listarDocumentos,
  registrarDocumento,
  TIPOS_DOCUMENTO,
} from "@/lib/rrhh/documentos";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { guardarUpload } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh");
  if (guard.error) return guard.error;

  const id = Number(idRaw);
  if (!id) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const emp = await obtenerEmpleado(guard.empresa.id, id);
    if (!emp) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }
    const documentos = await listarDocumentos(guard.empresa.id, id);
    return NextResponse.json({ documentos, empleado: emp });
  } catch (err) {
    console.error("GET documentos", err);
    return NextResponse.json(
      { error: "Error al listar. ¿Importaste migrate-2026-08-rrhh-archivos.sql?" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  const guard = await requireTenantModulo(slug, "rrhh", true);
  if (guard.error) return guard.error;

  const id = Number(idRaw);
  if (!id) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const emp = await obtenerEmpleado(guard.empresa.id, id);
    if (!emp) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    const form = await req.formData();
    const file = form.get("file");
    const tipoRaw = String(form.get("tipo") ?? "Otro");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    }

    const tipo = (TIPOS_DOCUMENTO as readonly string[]).includes(tipoRaw)
      ? tipoRaw
      : "Otro";

    const saved = await guardarUpload(
      guard.empresa.id,
      "documentos",
      `emp${id}`,
      file,
    );
    const docId = await registrarDocumento({
      empresaId: guard.empresa.id,
      idEmpleado: id,
      tipoDocumento: tipo,
      rutaArchivo: saved.relative,
      nombreOriginal: saved.original,
      subidoPor: guard.session.username,
    });

    return NextResponse.json({
      mensaje: "Documento subido.",
      id: docId,
      documento: {
        id: docId,
        tipoDocumento: tipo,
        nombreOriginal: saved.original,
      },
    });
  } catch (err) {
    console.error("POST documentos", err);
    const msg = err instanceof Error ? err.message : "No se pudo subir.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

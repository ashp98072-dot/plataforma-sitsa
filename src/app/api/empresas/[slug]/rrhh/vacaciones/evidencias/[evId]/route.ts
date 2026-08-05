import { createReadStream, existsSync, statSync } from "fs";
import { NextResponse } from "next/server";
import { Readable } from "stream";
import { requireTenantRrhhAny } from "@/lib/tenant";
import { eliminarEvidencia, obtenerEvidencia } from "@/lib/rrhh/evidencias";
import { absPathFromRelative, contentTypeFor } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; evId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, evId: raw } = await ctx.params;
  const guard = await requireTenantRrhhAny(
    slug,
    ["vacaciones", "incidencias"],
    "ver",
  );
  if (guard.error) return guard.error;

  const evId = Number(raw);
  if (!evId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const ev = await obtenerEvidencia(guard.empresa.id, evId);
    if (!ev) {
      return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    }
    const abs = absPathFromRelative(ev.rutaArchivo);
    if (!existsSync(abs)) {
      return NextResponse.json(
        { error: "Archivo no encontrado en disco." },
        { status: 404 },
      );
    }
    const stat = statSync(abs);
    const stream = createReadStream(abs);
    const webStream = Readable.toWeb(stream) as unknown as BodyInit;
    return new NextResponse(webStream, {
      headers: {
        "Content-Type": contentTypeFor(ev.rutaArchivo),
        "Content-Length": String(stat.size),
        "Content-Disposition": `inline; filename="${encodeURIComponent(ev.nombreOriginal || "evidencia")}"`,
      },
    });
  } catch (err) {
    console.error("GET evidencia file", err);
    return NextResponse.json({ error: "No se pudo leer el archivo." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, evId: raw } = await ctx.params;
  let guard = await requireTenantRrhhAny(
    slug,
    ["vacaciones", "incidencias"],
    "eliminar",
  );
  if (guard.error) {
    guard = await requireTenantRrhhAny(
      slug,
      ["vacaciones", "incidencias"],
      "editar",
    );
  }
  if (guard.error) return guard.error;

  const evId = Number(raw);
  if (!evId) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const result = await eliminarEvidencia(guard.empresa.id, evId);
    if (!result.ok) {
      return NextResponse.json({ error: result.mensaje }, { status: 404 });
    }
    return NextResponse.json({ mensaje: result.mensaje });
  } catch (err) {
    console.error("DELETE evidencia", err);
    return NextResponse.json({ error: "No se pudo eliminar." }, { status: 500 });
  }
}

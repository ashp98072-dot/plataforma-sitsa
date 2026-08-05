import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantRrhhAny } from "@/lib/tenant";
import { listarEvidencias, registrarEvidencia } from "@/lib/rrhh/evidencias";
import { guardarUpload } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

async function incidenciaDeEmpresa(
  empresaId: number,
  id: number,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    "SELECT id FROM incidencias WHERE id = ? AND empresa_id = ? LIMIT 1",
    [id, empresaId],
  );
  return rows.length > 0;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhhAny(
    slug,
    ["vacaciones", "incidencias"],
    "ver",
  );
  if (guard.error) return guard.error;

  const id = Number(raw);
  if (!id) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    if (!(await incidenciaDeEmpresa(guard.empresa.id, id))) {
      return NextResponse.json({ error: "Incidencia no encontrada." }, { status: 404 });
    }
    const evidencias = await listarEvidencias(guard.empresa.id, id);
    return NextResponse.json({ evidencias });
  } catch (err) {
    console.error("GET evidencias", err);
    return NextResponse.json(
      { error: "Error al listar. ¿Importaste migrate-2026-08-rrhh-archivos.sql?" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  let guard = await requireTenantRrhhAny(
    slug,
    ["vacaciones", "incidencias"],
    "crear",
  );
  if (guard.error) {
    guard = await requireTenantRrhhAny(
      slug,
      ["vacaciones", "incidencias"],
      "editar",
    );
  }
  if (guard.error) return guard.error;

  const id = Number(raw);
  if (!id) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    if (!(await incidenciaDeEmpresa(guard.empresa.id, id))) {
      return NextResponse.json({ error: "Incidencia no encontrada." }, { status: 404 });
    }

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file || typeof file.arrayBuffer !== "function") {
      return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    }

    const saved = await guardarUpload(
      guard.empresa.id,
      "evidencias",
      `inc${id}`,
      file,
    );
    const evId = await registrarEvidencia({
      empresaId: guard.empresa.id,
      incidenciaId: id,
      rutaArchivo: saved.relative,
      nombreOriginal: saved.original,
      subidoPor: guard.session.username,
    });

    return NextResponse.json({ mensaje: "Evidencia subida.", id: evId });
  } catch (err) {
    console.error("POST evidencias", err);
    const msg = err instanceof Error ? err.message : "No se pudo subir.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

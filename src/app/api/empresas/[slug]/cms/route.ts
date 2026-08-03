import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { requireTenantModulo } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "cms");
  if (guard.error) return guard.error;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, clave, titulo, contenido, imagen_url, orden, publicada
     FROM cms_secciones WHERE empresa_id = ? ORDER BY orden, id`,
    [guard.empresa.id],
  );
  return NextResponse.json({ secciones: rows });
}

const schema = z.object({
  clave: z.string().min(1),
  titulo: z.string().optional(),
  contenido: z.string().optional(),
  imagenUrl: z.string().optional(),
  orden: z.number().int().default(0),
  publicada: z.boolean().default(true),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "cms", true);
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  await execute(
    `INSERT INTO cms_secciones (empresa_id, clave, titulo, contenido, imagen_url, orden, publicada)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE titulo=VALUES(titulo), contenido=VALUES(contenido),
       imagen_url=VALUES(imagen_url), orden=VALUES(orden), publicada=VALUES(publicada)`,
    [
      guard.empresa.id,
      d.clave,
      d.titulo ?? null,
      d.contenido ?? null,
      d.imagenUrl ?? null,
      d.orden,
      d.publicada ? 1 : 0,
    ],
  );
  return NextResponse.json({ mensaje: "Sección guardada." });
}

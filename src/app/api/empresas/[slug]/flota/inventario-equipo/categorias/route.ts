import { NextResponse } from "next/server";
import { z } from "zod";
import { execute } from "@/lib/db";
import {
  asegurarInventarioEquipo,
  invalidarCatalogoInventario,
  listarCategorias,
} from "@/lib/flota/inventario-equipo";
import { requireTenantFlota } from "@/lib/tenant";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_inventario", "ver");
  if (guard.error) return guard.error;
  await asegurarInventarioEquipo(guard.empresa.id);
  return NextResponse.json({
    categorias: await listarCategorias(guard.empresa.id),
  });
}

const schema = z.object({
  nombre: z.string().min(1).max(80),
  descripcion: z.string().max(255).optional().nullable(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFlota(slug, "flota_inventario", "crear");
  if (guard.error) return guard.error;
  await asegurarInventarioEquipo(guard.empresa.id);

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Nombre obligatorio." }, { status: 400 });
  }
  try {
    const result = await execute(
      `INSERT INTO flota_inv_categorias (empresa_id, nombre, descripcion)
       VALUES (?, ?, ?)`,
      [
        guard.empresa.id,
        parsed.data.nombre.trim(),
        parsed.data.descripcion?.trim() || null,
      ],
    );
    invalidarCatalogoInventario(guard.empresa.id);
    return NextResponse.json({
      id: result.insertId,
      mensaje: "Categoría creada.",
    });
  } catch (err) {
    const code =
      typeof err === "object" && err && "code" in err
        ? String((err as { code?: string }).code)
        : "";
    if (code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Ya existe esa categoría." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: "No se pudo crear la categoría." },
      { status: 500 },
    );
  }
}

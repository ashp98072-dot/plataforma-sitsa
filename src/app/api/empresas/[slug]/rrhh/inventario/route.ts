import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { crearArticulo, listarArticulos } from "@/lib/rrhh/inventario";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "ver");
  if (guard.error) return guard.error;
  const q = new URL(req.url).searchParams.get("q") ?? undefined;
  const items = await listarArticulos(guard.empresa.id, { q });
  return NextResponse.json({ items });
}

const schema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  categoria: z.string().optional().nullable(),
  // Fase INV-0: "stock" en el body es el stock INICIAL al crear (genera un
  // movimiento ENTRADA) — no una escritura directa de la columna.
  stock: z.number().int().min(0).default(0),
  unidad: z.string().default("Unidad"),
  costoUnitario: z.number().min(0).optional().nullable(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "crear");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const resultado = await crearArticulo(
    guard.empresa.id,
    {
      codigo: d.codigo,
      nombre: d.nombre,
      categoria: d.categoria ?? null,
      stockInicial: d.stock,
      unidad: d.unidad,
      costoUnitario: d.costoUnitario ?? null,
    },
    guard.session.username,
  );
  if (!resultado.ok) {
    const status = resultado.motivo === "codigo_duplicado" ? 409 : 400;
    return NextResponse.json({ error: resultado.mensaje }, { status });
  }
  return NextResponse.json({ id: resultado.id, mensaje: "Artículo registrado." });
}

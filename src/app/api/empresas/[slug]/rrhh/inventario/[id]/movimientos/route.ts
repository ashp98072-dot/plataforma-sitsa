import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { listarMovimientos, obtenerArticulo, registrarMovimiento } from "@/lib/rrhh/inventario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "ver");
  if (guard.error) return guard.error;
  const articuloId = Number(id);
  if (!Number.isFinite(articuloId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const articulo = await obtenerArticulo(guard.empresa.id, articuloId);
  if (!articulo) {
    return NextResponse.json({ error: "Artículo no encontrado." }, { status: 404 });
  }
  const movimientos = await listarMovimientos(guard.empresa.id, articuloId);
  return NextResponse.json({ articulo, movimientos });
}

const schema = z.object({
  tipo: z.enum(["ENTRADA", "AJUSTE"]),
  cantidad: z.number().int().refine((n) => n !== 0, "La cantidad no puede ser cero."),
  motivo: z.string().max(300).optional().nullable(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  // Registrar un movimiento cambia el stock de un artículo existente — se
  // gatea con "editar", mismo criterio que cualquier otra modificación de
  // un registro ya creado en RRHH.
  const guard = await requireTenantRrhh(slug, "inventario", "editar");
  if (guard.error) return guard.error;
  const articuloId = Number(id);
  if (!Number.isFinite(articuloId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const resultado = await registrarMovimiento(guard.empresa.id, {
    articuloId,
    tipo: d.tipo,
    cantidad: d.cantidad,
    motivo: d.motivo ?? null,
    registradoPor: guard.session.username,
  });
  if (!resultado.ok) {
    const status = resultado.motivo === "stock_insuficiente" ? 409 : 400;
    return NextResponse.json({ error: resultado.mensaje }, { status });
  }
  const movimientos = await listarMovimientos(guard.empresa.id, articuloId);
  return NextResponse.json({
    mensaje: "Movimiento registrado.",
    stockResultante: resultado.stockResultante,
    movimientos,
  });
}

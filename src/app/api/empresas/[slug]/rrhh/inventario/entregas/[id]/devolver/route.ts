import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { registrarDevolucion } from "@/lib/rrhh/inventario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  cantidad: z.number().int().positive(),
  motivo: z.string().trim().min(1, "El motivo es obligatorio.").max(300),
});

function statusParaAjuste(motivo: string): number {
  if (motivo === "no_encontrado") return 404;
  if (
    motivo === "cantidad_excede_disponible" ||
    motivo === "stock_insuficiente" ||
    motivo === "devolucion_con_cobro_requiere_ajuste"
  ) {
    return 409;
  }
  if (motivo === "error") return 500;
  return 400;
}

/**
 * RRHH-INVENTARIO-CAMBIOS-1 — devuelve `cantidad` unidades de una entrega ya
 * realizada al stock del artículo original. Ver registrarDevolucion en
 * src/lib/rrhh/inventario.ts (transaccional, append-only, nunca toca la
 * entrega original ni ningún descuento). Tenant SIEMPRE desde la sesión —
 * nunca se acepta empresaId del cliente.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "inventario", "editar");
  if (guard.error) return guard.error;
  const entregaId = Number(id);
  if (!Number.isInteger(entregaId) || entregaId <= 0) {
    return NextResponse.json({ error: "id inválido." }, { status: 400 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const resultado = await registrarDevolucion(guard.empresa.id, entregaId, {
    cantidad: parsed.data.cantidad,
    motivo: parsed.data.motivo,
    registradoPor: guard.session.username,
  });
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensaje }, { status: statusParaAjuste(resultado.motivo) });
  }
  return NextResponse.json({
    ajusteId: resultado.ajusteId,
    entregaId: resultado.entregaId,
    cantidad: resultado.cantidad,
    stockResultante: resultado.stockResultante,
    mensaje: `Devolución registrada: ${resultado.cantidad} unidad(es).`,
  });
}

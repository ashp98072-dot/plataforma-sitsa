import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { registrarCambio } from "@/lib/rrhh/inventario";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  cantidad: z.number().int().positive(),
  articuloNuevoId: z.number().int().positive(),
  motivo: z.string().trim().min(1, "El motivo es obligatorio.").max(300),
});

function statusParaAjuste(motivo: string): number {
  if (motivo === "no_encontrado") return 404;
  if (
    motivo === "cantidad_excede_disponible" ||
    motivo === "stock_insuficiente" ||
    motivo === "diferencia_precio_no_soportada"
  ) {
    return 409;
  }
  if (motivo === "error") return 500;
  return 400;
}

/**
 * RRHH-INVENTARIO-CAMBIOS-1 — cambia `cantidad` unidades de una entrega por
 * otro artículo (ej. talla S -> M): devuelve stock del artículo original,
 * descuenta stock del nuevo, crea una entrega nueva vinculada a la original
 * — TODO en una transacción (ver registrarCambio en
 * src/lib/rrhh/inventario.ts). Si la entrega generó cobro y el artículo
 * nuevo cuesta distinto, se rechaza con 409 sin tocar nada (ver discovery:
 * ajuste de monto de un descuento activo queda fuera de este PR). Tenant
 * SIEMPRE desde la sesión.
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
  const resultado = await registrarCambio(guard.empresa.id, entregaId, {
    cantidad: parsed.data.cantidad,
    articuloNuevoId: parsed.data.articuloNuevoId,
    motivo: parsed.data.motivo,
    registradoPor: guard.session.username,
  });
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensaje }, { status: statusParaAjuste(resultado.motivo) });
  }
  return NextResponse.json({
    ajusteId: resultado.ajusteId,
    entregaId: resultado.entregaId,
    entregaNuevaId: resultado.entregaNuevaId,
    cantidad: resultado.cantidad,
    stockResultanteOriginal: resultado.stockResultanteOriginal,
    stockResultanteNuevo: resultado.stockResultanteNuevo,
    mensaje: `Cambio registrado: ${resultado.cantidad} unidad(es). Nueva entrega #${resultado.entregaNuevaId}.`,
  });
}

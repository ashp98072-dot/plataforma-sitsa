import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantCotizaciones, requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { ErrorSeleccionCosteo, seleccionarCosteo } from "@/lib/tms/cotizacion-costeo-historial";

type Ctx = { params: Promise<{ slug: string; id: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };

const schema = z.object({ costeoId: z.number().int().min(1).max(2147483647) }).strict();

/**
 * COTIZACIONES — HISTORIAL DE COSTEOS: «Usar este costeo». Marca una versión existente como la utilizada (las demás quedan sin marca).
 * No crea, modifica ni recalcula versiones. Exige editar la cotización Y el costeo interno (los mismos permisos que ya exige guardar un costeo);
 * la empresa y la cotización salen de la sesión/ruta y `costeoId` se revalida contra ambas dentro de la transacción.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantCotizaciones(slug, "editar");
  if (guard.error) return guard.error;
  const guardCosteo = await requireTenantCotizacionesCosteo(slug, "editar");
  if (guardCosteo.error) {
    guardCosteo.error.headers.set("Cache-Control", "private, no-store");
    return guardCosteo.error;
  }
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return NextResponse.json({ error: "Cotización no encontrada." }, { status: 404, headers: NO_STORE });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400, headers: NO_STORE });
  try {
    const r = await seleccionarCosteo(guard.empresa.id, Number(id), parsed.data.costeoId, guard.session.username);
    return NextResponse.json({ mensaje: r.cambio ? `Costeo versión ${r.version} seleccionado.` : `El costeo versión ${r.version} ya era el utilizado.`, ...r }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof ErrorSeleccionCosteo) return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    return NextResponse.json({ error: "No se pudo seleccionar el costeo." }, { status: 500, headers: NO_STORE });
  }
}

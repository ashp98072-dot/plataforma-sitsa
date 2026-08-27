import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { actualizarLinea, calcularCuadre, listarLineas } from "@/lib/rrhh/planillas";
import { normalizarFormaPago } from "@/lib/rrhh/contratos-pago";

type Ctx = {
  params: Promise<{ slug: string; id: string; lineaId: string }>;
};

const schema = z.object({
  formaPago: z.enum(["efectivo", "cheque", "transferencia"]).optional(),
  isr: z.number().finite().nonnegative().optional(),
  estadoPago: z.enum(["Pendiente", "Pagado"]).optional(),
  refPago: z.string().nullable().optional(),
  notas: z.string().nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id, lineaId } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "editar");
  if (guard.error) return guard.error;
  const periodoId = Number(id);
  const lid = Number(lineaId);
  if (!Number.isFinite(periodoId) || !Number.isFinite(lid)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  try {
  const linea = await actualizarLinea(guard.empresa.id, periodoId, lid, {
    formaPago: d.formaPago ? normalizarFormaPago(d.formaPago) : undefined,
    isr: d.isr,
    estadoPago: d.estadoPago,
    refPago: d.refPago,
    notas: d.notas,
  });
  if (!linea || linea.periodoId !== periodoId) {
    return NextResponse.json({ error: "Línea no encontrada." }, { status: 404 });
  }
  const lineas = await listarLineas(guard.empresa.id, periodoId);
  return NextResponse.json({
    mensaje: "Línea actualizada.",
    linea,
    lineas,
    cuadre: calcularCuadre(lineas),
  });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la línea." }, { status: 409 });
  }
}

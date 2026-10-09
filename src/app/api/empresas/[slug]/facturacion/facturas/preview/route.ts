import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantFacturacion } from "@/lib/tenant";
import { previsualizarFactura } from "@/lib/facturacion/facturas";

type Ctx = { params: Promise<{ slug: string }> };

const previewSchema = z.object({
  clienteId: z.number().int().positive(),
  planes: z
    .array(
      z.object({
        planId: z.number().int().positive(),
        montoAsignado: z.number().nonnegative().optional(),
        // Tratamiento de IVA de ESTA línea, explícito (true = incluido en la tarifa, false = se agrega). Sin valor por defecto.
        precioIncluyeIva: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * FACT-2 — vista previa del borrador. Es un POST solo porque recibe la selección en el cuerpo: NO escribe nada
 * (sin transacción, sin auditoría, sin reservar viajes). El servidor revalida y recalcula todo; empresa, cliente,
 * estado, tarifa y ruta salen de la base de datos, nunca del payload. Mismo permiso que crear el borrador
 * (`facturacion:crear`), porque expone el cálculo previo a su creación.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantFacturacion(slug, "crear");
  if (guard.error) return guard.error;

  const parsed = previewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const resultado = await previsualizarFactura(
    { empresaId: guard.empresa.id, usuarioId: guard.session.id, usuario: guard.session.username },
    { clienteId: parsed.data.clienteId, planes: parsed.data.planes },
  );
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json(resultado.preview, { headers: { "Cache-Control": "private, no-store" } });
}

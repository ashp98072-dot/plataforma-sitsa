import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { CATEGORIAS_GASTO, METODOS_PAGO_GASTO, actualizarGasto, obtenerGasto } from "@/lib/tms/gastos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const gasto = await obtenerGasto(guard.empresa.id, Number(id));
  if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
  return NextResponse.json({ gasto });
}

const schema = z.object({
  fechaSolicitud: z.string().min(1).optional(),
  fechaViaje: z.string().nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  vehiculoId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
  categoria: z.enum(CATEGORIAS_GASTO).optional(),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  monto: z.number().positive().max(9999999999.99).optional(),
  metodoPago: z.enum(METODOS_PAGO_GASTO).nullable().optional(),
  numeroCuentaPago: z.string().max(80).nullable().optional(),
  tieneFactura: z.boolean().optional(),
  observaciones: z.string().max(300).nullable().optional(),
  activo: z.boolean().optional(),
  /** GASTOS-ADMINISTRATIVO-1 (Fase 3) — ver POST de creación (gastos/route.ts). */
  entidadRequirenteId: z.number().int().positive().optional(),
  requirenteEmpleadoId: z.number().int().positive().nullable().optional(),
  requirenteNombre: z.string().max(200).nullable().optional(),
  requirenteUsuarioId: z.number().int().positive().nullable().optional(),
  solicitanteUsuarioId: z.number().int().positive().nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "editar");
  if (guard.error) return guard.error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  try {
    const gasto = await actualizarGasto(guard.empresa.id, Number(id), parsed.data);
    if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
    return NextResponse.json({ mensaje: "Gasto actualizado.", gasto });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar el gasto." }, { status: 400 });
  }
}

/** "Eliminar" = desactivar (activo=0) — nunca DELETE físico, mismo criterio que contactos/rutas. */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "eliminar");
  if (guard.error) return guard.error;
  const gasto = await actualizarGasto(guard.empresa.id, Number(id), { activo: false });
  if (!gasto) return NextResponse.json({ error: "Gasto no encontrado." }, { status: 404 });
  return NextResponse.json({ mensaje: "Gasto desactivado.", gasto });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { CATEGORIAS_GASTO } from "@/lib/tms/gastos";
import { actualizarSolicitudFondo, cambiarEstadoSolicitudFondo, obtenerSolicitudFondo } from "@/lib/tms/fondos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantGastos(slug, "ver");
  if (guard.error) return guard.error;
  const solicitud = await obtenerSolicitudFondo(guard.empresa.id, Number(id));
  if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  return NextResponse.json({ solicitud });
}

const lineaSchema = z.object({
  categoria: z.enum(CATEGORIAS_GASTO),
  descripcion: z.string().max(300).nullable().optional(),
  cantidad: z.number().positive().max(999999).optional(),
  monto: z.number().positive().max(9999999999.99),
  fechaViaje: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  empleadoId: z.number().int().positive().nullable().optional(),
  vehiculoId: z.number().int().positive().nullable().optional(),
  clienteId: z.number().int().positive().nullable().optional(),
  planId: z.number().int().positive().nullable().optional(),
});

const schema = z.object({
  accion: z.enum(["autorizar", "rechazar", "liquidar", "editar"]),
  // autorizar/rechazar
  autorizanteEmpleadoId: z.number().int().positive().nullable().optional(),
  autorizanteNombre: z.string().max(200).nullable().optional(),
  motivoRechazo: z.string().max(300).nullable().optional(),
  // SOLICITUD-FONDOS-REPORTE-1 (pendiente 1 del PR #211) — solo para
  // accion:"editar". Mismas líneas que el POST de creación (fondos/route.ts).
  fechaRequerimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requirenteEmpleadoId: z.number().int().positive().nullable().optional(),
  requirenteNombre: z.string().max(200).nullable().optional(),
  observaciones: z.string().max(300).nullable().optional(),
  lineas: z.array(lineaSchema).min(1).max(40).optional(),
});

/**
 * accion:"autorizar"|"rechazar"|"liquidar" — decisión administrativa
 * (cambia de estado, nunca toca las líneas).
 * accion:"editar" — edita encabezado y/o REEMPLAZA las líneas MIENTRAS
 * la solicitud está Pendiente (actualizarSolicitudFondo valida el
 * estado; aquí solo se enruta).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  // Cualquier escritura de este endpoint (cambiar estado o editar) exige "editar".
  const guard = await requireTenantGastos(slug, "editar");
  if (guard.error) return guard.error;

  try {
    if (parsed.data.accion === "editar") {
      const { fechaRequerimiento, requirenteEmpleadoId, requirenteNombre, observaciones, lineas } = parsed.data;
      const solicitud = await actualizarSolicitudFondo(guard.empresa.id, Number(id), {
        fechaRequerimiento, requirenteEmpleadoId, requirenteNombre, observaciones, lineas,
      }, guard.session.username);
      if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
      return NextResponse.json({ mensaje: "Solicitud actualizada.", solicitud });
    }

    const solicitud = await cambiarEstadoSolicitudFondo(guard.empresa.id, Number(id), parsed.data.accion, {
      usuario: guard.session.username,
      autorizanteEmpleadoId: parsed.data.autorizanteEmpleadoId,
      autorizanteNombre: parsed.data.autorizanteNombre ?? guard.session.username,
      motivoRechazo: parsed.data.motivoRechazo,
    });
    if (!solicitud) return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
    return NextResponse.json({ mensaje: "Solicitud actualizada.", solicitud });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo actualizar la solicitud." }, { status: 400 });
  }
}

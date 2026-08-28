import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { eliminarDescuentoPrueba } from "@/lib/admin/limpiar-pruebas";
import { LimpiezaBloqueada } from "@/lib/admin/limpiar-operaciones";
import {
  obtenerDescuento,
  listarCuotas,
  listarAbonos,
  autorizarDescuento,
  pausarDescuento,
  reanudarDescuento,
  cancelarDescuento,
  recalcularCuotasFuturas,
  registrarAbonoExtraordinario,
  statusParaMotivo,
  type ResultadoDescuento,
} from "@/lib/rrhh/descuentos";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "ver");
  if (guard.error) return guard.error;
  const descuentoId = Number(id);
  if (!Number.isFinite(descuentoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const descuento = await obtenerDescuento(guard.empresa.id, descuentoId);
  if (!descuento) {
    return NextResponse.json({ error: "Descuento no encontrado." }, { status: 404 });
  }
  const [cuotas, abonos] = await Promise.all([
    listarCuotas(guard.empresa.id, descuentoId),
    listarAbonos(guard.empresa.id, descuentoId),
  ]);
  return NextResponse.json(
    { descuento, cuotas, abonos, puedeEliminarPrueba: guard.session.rol === "Admin" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const patchSchema = z.object({
  accion: z.enum([
    "autorizar",
    "pausar",
    "reanudar",
    "cancelar",
    "recalcular_cuotas",
    "registrar_abono",
  ]),
  motivo: z.string().optional(),
  numeroCuotas: z.number().int().positive().max(60).optional(),
  montoCuota: z.number().positive().optional(),
  monto: z.number().positive().optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/** Temporal, solo Admin; no se permite habilitarlo mediante permisos de RRHH. */
export async function DELETE(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "editar");
  if (guard.error) return guard.error;
  if (guard.session.rol !== "Admin") return NextResponse.json({ error: "Solo Admin puede eliminar descuentos de prueba." }, { status: 403 });
  const descuentoId = Number(id);
  if (!Number.isSafeInteger(descuentoId) || descuentoId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (body?.confirmacion !== `ELIMINAR DESCUENTO ${descuentoId}`) return NextResponse.json({ error: "Confirmación incorrecta." }, { status: 400 });
  try {
    const afectados = await eliminarDescuentoPrueba(guard.empresa.id, descuentoId, guard.session.username);
    return NextResponse.json({ mensaje: "Descuento de prueba eliminado. No se modificaron planillas ni archivos físicos.", afectados });
  } catch (error) {
    if (error instanceof LimpiezaBloqueada) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Eliminar descuento de prueba", error);
    return NextResponse.json({ error: "No se pudo eliminar. Se revirtieron los cambios; revisa el registro del servidor." }, { status: 500 });
  }
}

/** Fase D1: una sola ruta de acciones (accion: string), mismo patrón ya
 * usado en rrhh/planillas/[id] y tms/planes — no se crean 6 endpoints. */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "editar");
  if (guard.error) return guard.error;
  const descuentoId = Number(id);
  if (!Number.isFinite(descuentoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }
  const d = parsed.data;
  const usuario = guard.session.username;
  const empresaId = guard.empresa.id;

  let r: ResultadoDescuento;
  if (d.accion === "autorizar") {
    r = await autorizarDescuento(empresaId, descuentoId, usuario);
  } else if (d.accion === "pausar") {
    r = await pausarDescuento(empresaId, descuentoId, d.motivo ?? "", usuario);
  } else if (d.accion === "reanudar") {
    r = await reanudarDescuento(empresaId, descuentoId, usuario);
  } else if (d.accion === "cancelar") {
    r = await cancelarDescuento(empresaId, descuentoId, d.motivo ?? "", usuario);
  } else if (d.accion === "recalcular_cuotas") {
    r = await recalcularCuotasFuturas(
      empresaId,
      descuentoId,
      { numeroCuotas: d.numeroCuotas, montoCuota: d.montoCuota },
      usuario,
    );
  } else {
    if (d.monto == null || !d.fecha) {
      return NextResponse.json(
        { error: "Monto y fecha son obligatorios para el abono." },
        { status: 400 },
      );
    }
    r = await registrarAbonoExtraordinario(empresaId, descuentoId, {
      monto: d.monto,
      fecha: d.fecha,
      motivo: d.motivo ?? "",
      registradoPor: usuario,
    });
  }

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: statusParaMotivo(r.motivo) });
  }

  const [descuento, cuotas, abonos] = await Promise.all([
    obtenerDescuento(empresaId, descuentoId),
    listarCuotas(empresaId, descuentoId),
    listarAbonos(empresaId, descuentoId),
  ]);
  return NextResponse.json({ mensaje: "Operación realizada.", descuento, cuotas, abonos });
}

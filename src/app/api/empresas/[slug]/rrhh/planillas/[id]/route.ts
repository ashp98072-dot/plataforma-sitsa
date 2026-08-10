import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  actualizarEstadoPeriodo,
  calcularCuadre,
  generarLineasPeriodo,
  listarLineas,
  marcarPagos,
  obtenerPeriodo,
} from "@/lib/rrhh/planillas";
import { normalizarFormaPago } from "@/lib/rrhh/contratos-pago";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "ver");
  if (guard.error) return guard.error;
  const periodoId = Number(id);
  if (!Number.isFinite(periodoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const periodo = await obtenerPeriodo(guard.empresa.id, periodoId);
  if (!periodo) {
    return NextResponse.json({ error: "Periodo no encontrado." }, { status: 404 });
  }
  const lineas = await listarLineas(guard.empresa.id, periodoId);
  return NextResponse.json({
    periodo,
    lineas,
    cuadre: calcularCuadre(lineas),
  });
}

const patchSchema = z.object({
  accion: z.enum([
    "generar",
    "marcar_pagados",
    "marcar_pendientes",
    "cerrar",
    "reabrir",
  ]),
  formaPago: z
    .enum(["efectivo", "cheque", "transferencia", "todas"])
    .optional(),
  conservarPagos: z.boolean().optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "planillas", "editar");
  if (guard.error) return guard.error;
  const periodoId = Number(id);
  if (!Number.isFinite(periodoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }
  const periodo = await obtenerPeriodo(guard.empresa.id, periodoId);
  if (!periodo) {
    return NextResponse.json({ error: "Periodo no encontrado." }, { status: 404 });
  }

  try {
    const { accion } = parsed.data;
    if (accion === "generar") {
      const r = await generarLineasPeriodo(guard.empresa.id, periodoId, {
        conservarPagos: parsed.data.conservarPagos !== false,
      });
      const lineas = await listarLineas(guard.empresa.id, periodoId);
      return NextResponse.json({
        mensaje: `Planilla generada: ${r.generadas} empleado(s).`,
        generadas: r.generadas,
        periodo: await obtenerPeriodo(guard.empresa.id, periodoId),
        lineas,
        cuadre: calcularCuadre(lineas),
      });
    }
    if (accion === "marcar_pagados" || accion === "marcar_pendientes") {
      const forma =
        parsed.data.formaPago && parsed.data.formaPago !== "todas"
          ? normalizarFormaPago(parsed.data.formaPago)
          : "todas";
      const n = await marcarPagos(guard.empresa.id, periodoId, {
        formaPago: forma,
        estadoPago: accion === "marcar_pagados" ? "Pagado" : "Pendiente",
        soloPendientes: accion === "marcar_pagados",
      });
      const lineas = await listarLineas(guard.empresa.id, periodoId);
      return NextResponse.json({
        mensaje: `${n} línea(s) actualizada(s).`,
        lineas,
        cuadre: calcularCuadre(lineas),
      });
    }
    if (accion === "cerrar") {
      await actualizarEstadoPeriodo(guard.empresa.id, periodoId, "Cerrada");
      return NextResponse.json({
        mensaje: "Planilla cerrada.",
        periodo: await obtenerPeriodo(guard.empresa.id, periodoId),
      });
    }
    if (accion === "reabrir") {
      await actualizarEstadoPeriodo(guard.empresa.id, periodoId, "Generada");
      return NextResponse.json({
        mensaje: "Planilla reabierta.",
        periodo: await obtenerPeriodo(guard.empresa.id, periodoId),
      });
    }
    return NextResponse.json({ error: "Acción no soportada." }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error en planilla.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

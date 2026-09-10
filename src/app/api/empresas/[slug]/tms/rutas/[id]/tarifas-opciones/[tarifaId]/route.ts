import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRutas } from "@/lib/tenant";
import {
  actualizarTarifaRuta,
  cambiarEstadoTarifa,
  marcarPredeterminada,
} from "@/lib/tms/ruta-tarifas";

type Ctx = { params: Promise<{ slug: string; id: string; tarifaId: string }> };

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§1) — editar una tarifa,
 * activarla/desactivarla o marcarla como predeterminada. `accion` decide:
 *   - "editar"        -> nombre/descripcion/monto/moneda/vigencias/observacion
 *   - "activar"       -> activa = true
 *   - "desactivar"    -> activa = false (si era predeterminada, se promueve otra)
 *   - "predeterminada"-> marca esta como la predeterminada (debe estar activa)
 */
const schema = z.discriminatedUnion("accion", [
  z.object({
    accion: z.literal("editar"),
    nombre: z.string().min(1).max(120).optional(),
    descripcion: z.string().max(300).nullish(),
    monto: z.number().nonnegative().max(9999999999.99).optional(),
    moneda: z.string().min(1).max(10).optional(),
    vigenteDesde: z.string().regex(FECHA_RE).optional(),
    vigenteHasta: z.string().regex(FECHA_RE).nullish(),
    observacion: z.string().max(300).nullish(),
  }),
  z.object({ accion: z.literal("activar") }),
  z.object({ accion: z.literal("desactivar") }),
  z.object({ accion: z.literal("predeterminada") }),
]);

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, tarifaId } = await ctx.params;
  const guard = await requireTenantRutas(slug, "editar");
  if (guard.error) return guard.error;
  const tid = Number(tarifaId);
  if (!Number.isFinite(tid)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Acción o datos inválidos." }, { status: 400 });

  const actor = { usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username };
  const eid = guard.empresa.id;
  try {
    const d = parsed.data;
    let tarifas;
    if (d.accion === "editar") {
      const cambios = { ...d, accion: undefined };
      tarifas = await actualizarTarifaRuta(eid, tid, cambios, actor);
    } else if (d.accion === "activar") {
      tarifas = await cambiarEstadoTarifa(eid, tid, true, actor);
    } else if (d.accion === "desactivar") {
      tarifas = await cambiarEstadoTarifa(eid, tid, false, actor);
    } else {
      tarifas = await marcarPredeterminada(eid, tid, actor);
    }
    return NextResponse.json({ tarifas, mensaje: "Tarifa actualizada." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo actualizar la tarifa." },
      { status: 400 },
    );
  }
}

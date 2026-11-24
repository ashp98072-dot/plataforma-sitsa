import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantModulo } from "@/lib/tenant";
import { actualizarMontoViatico } from "@/lib/tms/viaticos";
import { query } from "@/lib/db";
import { fondosDiariosInstalado, sincronizarFondosDePlanes } from "@/lib/tms/fondos-diarios";
import type { RowDataPacket } from "mysql2";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({
  montoAsignado: z.number().nonnegative(),
  motivoCambio: z.string().max(300).optional(),
});

/**
 * VIAT-0 (punto 7) — modifica el monto asignado de UN viático ya existente
 * (creado automáticamente al asignar piloto/auxiliares). Si el monto difiere
 * del sugerido, exige motivo (actualizarMontoViatico lo valida de nuevo
 * server-side, nunca se confía solo en que la UI ya lo pidió). Guarda quién
 * hizo el cambio. No permite marcar ENTREGADO/LIQUIDADO ni cambiar estado —
 * ese endpoint no existe todavía (fase VIAT-1, operativa, sin relación con
 * Planillas/nómina).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const viaticoId = Number(id);
  if (!Number.isFinite(viaticoId)) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  const r = await actualizarMontoViatico(
    guard.empresa.id,
    viaticoId,
    d.montoAsignado,
    d.motivoCambio ?? null,
    guard.session.username,
  );
  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }
  // FONDOS DIARIOS: el monto ya está confirmado; se refleja en la línea AUTO_VIATICO de la solicitud (diferencial, sin duplicar; si la principal ya fue AUTORIZADA no se toca
  // y un viático nuevo iría a la complementaria excepcional). Un fallo no revierte el monto: solo advertencia (se corrige al guardar el viaje o con «Resincronizar»).
  let advertenciaFondos: string | undefined;
  try {
    const [v] = await query<RowDataPacket[]>("SELECT plan_id FROM tms_viaticos WHERE id = ? AND empresa_id = ? LIMIT 1", [viaticoId, guard.empresa.id]);
    if (v?.plan_id != null && (await fondosDiariosInstalado())) {
      const s = guard.session;
      advertenciaFondos = (await sincronizarFondosDePlanes(guard.empresa.id, [Number(v.plan_id)], { usuarioId: s.id, nombre: s.nombre || s.username, username: s.username })).advertencia;
    }
  } catch (e) { console.error("viatico PATCH: sincronizar fondos", e); }
  return NextResponse.json({ mensaje: "Viático actualizado.", ...(advertenciaFondos ? { advertenciaFondos } : {}) });
}

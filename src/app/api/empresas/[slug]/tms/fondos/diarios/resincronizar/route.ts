import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantGastos } from "@/lib/tenant";
import { fondosDiariosInstalado, resincronizarGrupoDiario } from "@/lib/tms/fondos-diarios";
import { respuestaFalloOperacion } from "@/lib/tms/validacion-fondos-gastos";

type Ctx = { params: Promise<{ slug: string }> };

const schema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entidadRequirenteId: z.number().int().positive(),
});

/**
 * POST: resincroniza las solicitudes de fondos diarias de UN día y empresa requirente con los viajes y viáticos reales (acción explícita de reparación). Es idempotente: sin
 * diferencias no cambia nada. Permiso de editar Fondos; la empresa y el usuario salen SIEMPRE de la sesión.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantGastos(slug, "editar");
  if (guard.error) return guard.error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica la fecha (AAAA-MM-DD) y la empresa requirente." }, { status: 400 });
  if (!(await fondosDiariosInstalado())) return NextResponse.json({ error: "La integración de fondos diarios aún no está instalada en esta base de datos." }, { status: 409 });
  try {
    const r = await resincronizarGrupoDiario(guard.empresa.id, parsed.data.fecha, parsed.data.entidadRequirenteId, {
      usuarioId: guard.session.id, nombre: guard.session.nombre || guard.session.username, username: guard.session.username,
    });
    return NextResponse.json({ mensaje: r.cambios ? `Se aplicaron ${r.cambios} cambio(s).` : "Todo está sincronizado.", cambios: r.cambios, solicitudes: r.solicitudes }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return respuestaFalloOperacion(error, "POST tms/fondos/diarios/resincronizar");
  }
}

import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { eliminarRegistroVacaciones } from "@/lib/rrhh/vacaciones-eliminar";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * DELETE /api/empresas/[slug]/rrhh/vacaciones/[id] — [id] es incidencias.id.
 * Permiso exigido: RRHH · vacaciones · ELIMINAR (ver/crear/editar no bastan). La empresa sale de la sesión.
 * Elimina el registro y devuelve al saldo, período por período, lo que consumió (detalle FIFO). Una sola transacción.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id: raw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "eliminar");
  if (guard.error) return guard.error;

  const id = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const r = await eliminarRegistroVacaciones(guard.empresa.id, id, guard.session.username);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({
      ok: true,
      mensaje: r.mensaje,
      diasRestaurados: r.diasRestaurados,
      empleadoId: r.empleadoId,
      desglose: r.desglose,
      diasAjustadosPorTope: r.diasAjustadosPorTope,
      diasNoRestaurados: r.diasNoRestaurados,
      espejoEliminado: r.espejoEliminado,
      advertencias: r.advertencias,
    });
  } catch (err) {
    console.error("DELETE rrhh/vacaciones/[id] (rollback total)", err);
    return NextResponse.json({ error: "No se pudo eliminar el registro. No se modificó nada." }, { status: 500 });
  }
}

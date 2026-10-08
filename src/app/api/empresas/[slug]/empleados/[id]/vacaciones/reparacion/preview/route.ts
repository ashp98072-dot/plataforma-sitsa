import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import { previsualizarReparacion } from "@/lib/rrhh/vacaciones-reparacion-db";

type Ctx = { params: Promise<{ slug: string; id: string }> };

/**
 * Vista previa de la REPARACIÓN ADMINISTRADA de la serie de vacaciones de un colaborador: diagnostica si sus `saldos_vacaciones` no coinciden con su
 * `empleados.fecha_alta` actual y propone la serie reconstruida desde ESA fecha (períodos actuales y propuestos, traslapes, años duplicados, períodos
 * fuera de base, consumo que se conserva, saldo antes/después, bloqueos y advertencias). SOLO LECTURA: no sincroniza ni escribe nada.
 * La empresa sale del slug/sesión; no se acepta `empresa_id` ni la fecha del cliente. Permiso: RRHH · Vacaciones · editar.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "editar");
  if (guard.error) return guard.error;
  const empId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(empId) || empId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  try {
    const previa = await previsualizarReparacion(guard.empresa.id, empId);
    if (!previa) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    return NextResponse.json(previa, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[empleados/vacaciones/reparacion/preview]", error);
    return NextResponse.json({ error: "No se pudo calcular la vista previa." }, { status: 500 });
  }
}

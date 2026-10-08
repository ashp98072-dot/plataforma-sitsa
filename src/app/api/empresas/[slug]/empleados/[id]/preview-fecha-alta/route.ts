import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { previsualizarRebase } from "@/lib/rrhh/vacaciones-rebase-db";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({ fechaAlta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

/**
 * Vista previa de cambiar `empleados.fecha_alta` (RRHH → Empleados): si el colaborador ya tiene saldos o vacaciones, informa cómo se rebasarán sus
 * períodos de vacaciones (períodos actuales y resultantes, días consumidos que se conservan, saldo antes/después) y los BLOQUEOS que impedirían
 * guardar. SOLO LECTURA. La empresa sale del slug/sesión. Permiso: RRHH · Empleados · editar (el mismo que guardar la ficha).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) return guard.error;
  const empId = Number(id);
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(empId) || empId <= 0) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const parsed = schema.safeParse({ fechaAlta: new URL(req.url).searchParams.get("fechaAlta") ?? "" });
  if (!parsed.success) return NextResponse.json({ error: "Fecha inválida (use YYYY-MM-DD)." }, { status: 400 });
  try {
    const plan = await previsualizarRebase(guard.empresa.id, empId, parsed.data.fechaAlta);
    if (!plan) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    return NextResponse.json(plan, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[empleados/preview-fecha-alta]", error);
    return NextResponse.json({ error: "No se pudo calcular la vista previa." }, { status: 500 });
  }
}

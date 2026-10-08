import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { contarDiasHabiles } from "@/lib/rrhh/vacaciones";
import { previsualizarRegistro } from "@/lib/rrhh/vacaciones-registro";

type Ctx = { params: Promise<{ slug: string }> };

const schema = z.object({
  empleadoId: z.coerce.number().int().positive().max(2147483647),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  fechaFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  diasHabiles: z.coerce.number().positive().max(366).optional(),
});

/**
 * Vista previa del consumo de un registro HISTÓRICO, antes del POST real. SOLO LECTURA (no sincroniza ni escribe): informa si la fecha de inicio
 * cae en un período que hoy está Vencido («Registro histórico»), qué períodos consumiría y cuántos días por período, el saldo HISTÓRICO disponible
 * en esa fecha (no el de hoy), el déficit, las advertencias, las superposiciones y las decisiones pendientes. La empresa sale del slug/sesión.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "ver");
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const parsed = schema.safeParse(Object.fromEntries(["empleadoId", "fechaInicio", "fechaFin", "diasHabiles"].map((c) => [c, url.searchParams.get(c) ?? undefined]).filter(([, v]) => v !== undefined && v !== "")));
  if (!parsed.success) return NextResponse.json({ error: "Parámetros inválidos." }, { status: 400 });
  const d = parsed.data;
  if (d.fechaFin < d.fechaInicio) return NextResponse.json({ error: "La fecha de fin no puede ser anterior a la de inicio." }, { status: 400 });
  try {
    const dias = d.diasHabiles ?? (await contarDiasHabiles(guard.empresa.id, d.fechaInicio, d.fechaFin));
    const r = await previsualizarRegistro(guard.empresa.id, d.empleadoId, d.fechaInicio, d.fechaFin, dias);
    return NextResponse.json({ ...r, diasHabiles: dias }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[vacaciones/preview-historico]", error);
    return NextResponse.json({ error: "No se pudo calcular la vista previa." }, { status: 500 });
  }
}

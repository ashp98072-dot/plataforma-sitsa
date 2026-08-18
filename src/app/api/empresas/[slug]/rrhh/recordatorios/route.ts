import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { crearRecordatorio, listarRecordatorios } from "@/lib/rrhh/recordatorios";

type Ctx = { params: Promise<{ slug: string }> };

const crearSchema = z.object({
  tipo: z.enum(["Contrato", "ObligacionLegal", "ExamenMedico", "CitaLegal", "Otro"]),
  titulo: z.string().min(1),
  fecha: z.string().min(1),
  recurrente: z.boolean().optional(),
  diasAvisoPrevio: z.number().int().min(0).max(365).optional(),
  empleadoId: z.number().int().positive().optional().nullable(),
  notas: z.string().optional().nullable(),
});

/**
 * GET /api/empresas/[slug]/rrhh/recordatorios
 * ?proximos=1 -> solo los no atendidos dentro de su ventana de aviso (dashboard).
 * Sin ese parámetro -> todos (pantalla de administración de recordatorios).
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "recordatorios", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const soloProximos = url.searchParams.get("proximos") === "1";

  const recordatorios = await listarRecordatorios(guard.empresa.id, {
    soloPendientesProximos: soloProximos,
  });
  return NextResponse.json({ recordatorios });
}

/**
 * POST /api/empresas/[slug]/rrhh/recordatorios
 * Crea un recordatorio nuevo (las licencias de conducir NO se crean aquí,
 * se generan automáticamente desde la ficha del empleado).
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "recordatorios", "editar");
  if (guard.error) return guard.error;

  const parsed = crearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const creadoPor = guard.session.nombre || guard.session.username || "RRHH";

  const r = await crearRecordatorio({
    empresaId: guard.empresa.id,
    tipo: parsed.data.tipo,
    titulo: parsed.data.titulo,
    fecha: parsed.data.fecha,
    recurrente: parsed.data.recurrente,
    diasAvisoPrevio: parsed.data.diasAvisoPrevio,
    empleadoId: parsed.data.empleadoId,
    notas: parsed.data.notas,
    creadoPor,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje, id: r.id });
}
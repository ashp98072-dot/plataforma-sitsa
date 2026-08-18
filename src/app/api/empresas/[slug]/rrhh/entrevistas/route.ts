import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  crearEntrevista,
  listarEntrevistasPorMes,
} from "@/lib/rrhh/entrevistas";

type Ctx = { params: Promise<{ slug: string }> };

const crearSchema = z.object({
  candidatoNombre: z.string().min(1),
  candidatoTelefono: z.string().optional().nullable(),
  candidatoEmail: z.string().email().optional().nullable().or(z.literal("")),
  puesto: z.string().min(1),
  fechaHora: z.string().min(1),
  entrevistadorEmpleadoId: z.number().int().positive().optional().nullable(),
  modalidad: z.enum(["Presencial", "Virtual"]).optional(),
  lugarOEnlace: z.string().optional().nullable(),
  notas: z.string().optional().nullable(),
});

/**
 * GET /api/empresas/[slug]/rrhh/entrevistas?anio=2026&mes=8
 * Devuelve todas las entrevistas de ese mes calendario (para el calendario de RRHH).
 * Si no se pasan anio/mes, usa el mes actual.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const hoy = new Date();
  const anio = Number(url.searchParams.get("anio")) || hoy.getFullYear();
  const mes = Number(url.searchParams.get("mes")) || hoy.getMonth() + 1;
  if (mes < 1 || mes > 12) {
    return NextResponse.json({ error: "Mes inválido." }, { status: 400 });
  }

  const entrevistas = await listarEntrevistasPorMes(guard.empresa.id, anio, mes);
  return NextResponse.json({ entrevistas });
}

/**
 * POST /api/empresas/[slug]/rrhh/entrevistas
 * Programa una nueva entrevista.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "editar");
  if (guard.error) return guard.error;

  const parsed = crearSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const creadoPor = guard.session.nombre || guard.session.username || "RRHH";

  const r = await crearEntrevista({
    empresaId: guard.empresa.id,
    candidatoNombre: parsed.data.candidatoNombre,
    candidatoTelefono: parsed.data.candidatoTelefono,
    candidatoEmail: parsed.data.candidatoEmail || null,
    puesto: parsed.data.puesto,
    fechaHora: parsed.data.fechaHora,
    entrevistadorEmpleadoId: parsed.data.entrevistadorEmpleadoId,
    modalidad: parsed.data.modalidad,
    lugarOEnlace: parsed.data.lugarOEnlace,
    notas: parsed.data.notas,
    creadoPor,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.mensaje }, { status: 400 });
  }
  return NextResponse.json({ mensaje: r.mensaje, id: r.id });
}
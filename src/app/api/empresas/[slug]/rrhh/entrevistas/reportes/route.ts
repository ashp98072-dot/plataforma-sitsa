import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { obtenerReporteEntrevistas } from "@/lib/rrhh/entrevistas-reportes";

type Ctx = { params: Promise<{ slug: string }> };

const filtrosSchema = z.object({
  fechaDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  fechaHasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  puesto: z.string().max(200).optional(),
  estado: z.enum(["Programada", "Realizada", "Cancelada", "No asistió"]).optional(),
  resultado: z.enum(["Pendiente", "Aprobado", "Rechazado"]).optional(),
  entrevistadorEmpleadoId: z.coerce.number().int().positive().optional(),
  // ATRACCION-TALENTO-2 — filtro por entrevistador principal (usuario); coexiste con el histórico por empleado.
  entrevistadorUsuarioId: z.coerce.number().int().positive().optional(),
  candidato: z.string().max(200).optional(),
});

/**
 * GET /api/empresas/[slug]/rrhh/entrevistas/reportes
 * ATRACCION-TALENTO-1 (sección 16) — mismo guard que el resto de
 * Entrevistas: requireTenantRrhh(slug, "entrevistas", "ver") — reutiliza el
 * permiso existente, no crea uno nuevo. Tenant SIEMPRE desde la sesión
 * (guard.empresa.id), nunca aceptado del cliente.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "entrevistas", "ver");
  if (guard.error) return guard.error;

  const sp = new URL(req.url).searchParams;
  const parsed = filtrosSchema.safeParse({
    fechaDesde: sp.get("fechaDesde") || undefined,
    fechaHasta: sp.get("fechaHasta") || undefined,
    puesto: sp.get("puesto") || undefined,
    estado: sp.get("estado") || undefined,
    resultado: sp.get("resultado") || undefined,
    entrevistadorEmpleadoId: sp.get("entrevistadorEmpleadoId") || undefined,
    entrevistadorUsuarioId: sp.get("entrevistadorUsuarioId") || undefined,
    candidato: sp.get("candidato") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Filtros inválidos." }, { status: 400 });
  }

  const reporte = await obtenerReporteEntrevistas(guard.empresa.id, parsed.data);
  return NextResponse.json(reporte, { headers: { "Cache-Control": "private, no-store" } });
}

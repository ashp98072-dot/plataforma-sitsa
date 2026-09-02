import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacion } from "@/lib/tenant";
import { programarSolicitud } from "@/lib/tms/solicitudes-cliente-operaciones";

type Ctx = { params: Promise<{ slug: string; id: string }> };

const schema = z.object({ version: z.number().int().nonnegative() });

/**
 * CLIENTE-PORTAL-3 (alcance 7-12) — conversión EN_REVISION -> PROGRAMADA
 * + creación del plan TMS. Mismo permiso que POST /tms/planes ("crear"
 * en Programación es la acción propia). Toda la lógica crítica
 * (FOR UPDATE, validaciones, transacción, idempotencia) vive en
 * programarSolicitud() — esta ruta solo traduce guard + body + status
 * HTTP.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "crear");
  if (guard.error) return guard.error;

  const solicitudId = Number(id);
  if (!Number.isFinite(solicitudId) || solicitudId <= 0) {
    return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }

  const r = await programarSolicitud(
    guard.empresa.id,
    solicitudId,
    parsed.data.version,
    guard.session.username,
  );
  if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: r.status });
  return NextResponse.json({
    planId: r.planId,
    planCodigo: r.planCodigo,
    mensaje: "Solicitud programada correctamente.",
  });
}

import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  listarSolicitudes,
  type EstadoSolicitud,
} from "@/lib/rrhh/solicitudes-vacaciones";

type Ctx = { params: Promise<{ slug: string }> };

const ESTADOS_VALIDOS = new Set<EstadoSolicitud>([
  "Pendiente",
  "Aprobada",
  "Rechazada",
]);

/**
 * GET /api/empresas/[slug]/rrhh/vacaciones/solicitudes
 * Por defecto devuelve solo las Pendientes (la bandeja de RRHH).
 * ?estado=Aprobada|Rechazada para filtrar otro estado.
 * ?estado=todas para ver el historial completo.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "vacaciones", "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const estadoParam = url.searchParams.get("estado");

  let estado: EstadoSolicitud | undefined;
  if (estadoParam === "todas") {
    estado = undefined;
  } else if (estadoParam && ESTADOS_VALIDOS.has(estadoParam as EstadoSolicitud)) {
    estado = estadoParam as EstadoSolicitud;
  } else {
    estado = "Pendiente";
  }

  const solicitudes = await listarSolicitudes(
    guard.empresa.id,
    estado ? { estado } : undefined,
  );
  return NextResponse.json({ solicitudes });
}
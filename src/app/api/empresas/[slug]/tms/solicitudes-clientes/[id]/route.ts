import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantProgramacion, requireTenantProgramacionOTms } from "@/lib/tenant";
import {
  obtenerSolicitudClienteInterno,
  rechazarSolicitud,
  tomarEnRevisionSolicitud,
} from "@/lib/tms/solicitudes-cliente-operaciones";

type Ctx = { params: Promise<{ slug: string; id: string }> };

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;

  const solicitudId = parseId(id);
  if (!solicitudId) {
    return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  }
  const solicitud = await obtenerSolicitudClienteInterno(guard.empresa.id, solicitudId);
  if (!solicitud) {
    return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  }
  return NextResponse.json(
    { solicitud },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.union([
  z.object({ accion: z.literal("revisar"), version: z.number().int().nonnegative() }),
  z.object({
    accion: z.literal("rechazar"),
    version: z.number().int().nonnegative(),
    motivo: z.string().trim().min(1).max(500),
  }),
]);

/**
 * CLIENTE-PORTAL-3 (alcance 5/6) — transiciones internas SOLICITADA ->
 * EN_REVISION y SOLICITADA|EN_REVISION -> RECHAZADA. Mismo permiso que
 * PATCH /tms/planes (editar un viaje/su flujo es una acción propia de
 * Programación, no "tms:editar" genérico). `version` SIEMPRE viene del
 * cliente (el que mostró la pantalla) pero solo autoriza la transición
 * si coincide con la versión REAL en la base — un compare-and-swap, no
 * una autoridad por sí sola.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantProgramacion(slug, "editar");
  if (guard.error) return guard.error;

  const solicitudId = parseId(id);
  if (!solicitudId) {
    return NextResponse.json({ error: "Solicitud no encontrada." }, { status: 404 });
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Datos inválidos." },
      { status: 400 },
    );
  }

  if (parsed.data.accion === "revisar") {
    const r = await tomarEnRevisionSolicitud(
      guard.empresa.id,
      solicitudId,
      parsed.data.version,
      guard.session.username,
    );
    if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: r.status });
    return NextResponse.json({ mensaje: "Solicitud tomada en revisión." });
  }

  // accion === "rechazar"
  const r = await rechazarSolicitud(
    guard.empresa.id,
    solicitudId,
    parsed.data.version,
    parsed.data.motivo,
    guard.session.username,
  );
  if (!r.ok) return NextResponse.json({ error: r.mensaje }, { status: r.status });
  return NextResponse.json({ mensaje: "Solicitud rechazada." });
}

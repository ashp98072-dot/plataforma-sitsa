import { NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantRrhh } from "@/lib/tenant";
import { hoyLocal } from "@/lib/rrhh/dates";
import { cerrarAsistenciaDia, obtenerAsistenciaDia, validarFechaAsistencia } from "@/lib/rrhh/asistencia-diaria";

type Ctx = { params: Promise<{ slug: string }> };

/**
 * RRHH-TOMAR-ASISTENCIA-1 — RRHH > Marcajes > Tomar asistencia.
 * Solo RRHH/admin: exige el permiso de escritura de Marcajes Y rechaza al
 * rol "Marcaje" (kiosco), que nunca ve ni usa esta pantalla. La empresa sale
 * SIEMPRE de la sesión — el cuerpo no acepta empresa_id.
 */
async function autorizar(slug: string) {
  const guard = await requireTenantRrhh(slug, "marcajes", "crear");
  if (guard.error) return { error: guard.error };
  if (guard.session.rol === "Marcaje") {
    return { error: NextResponse.json({ error: "El kiosco de marcaje no puede tomar asistencia." }, { status: 403 }) };
  }
  return { guard };
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const a = await autorizar(slug);
  if (a.error) return a.error;
  const hoy = hoyLocal();
  const fecha = new URL(req.url).searchParams.get("fecha") || hoy;
  const error = validarFechaAsistencia(fecha, hoy);
  if (error) return NextResponse.json({ error }, { status: 400 });
  const dia = await obtenerAsistenciaDia(a.guard.empresa.id, fecha);
  return NextResponse.json({ ...dia, hoy }, { headers: { "Cache-Control": "private, no-store" } });
}

const cuerpo = z.object({
  fecha: z.string(),
  empleadoIds: z.array(z.number().int().positive()).max(5000),
});

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const a = await autorizar(slug);
  if (a.error) return a.error;
  const parsed = cuerpo.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  try {
    const r = await cerrarAsistenciaDia(a.guard.empresa.id, {
      fecha: parsed.data.fecha,
      empleadoIds: parsed.data.empleadoIds,
      usuario: a.guard.session.username,
      hoy: hoyLocal(),
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json(r, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("POST rrhh/asistencia", e);
    return NextResponse.json({ error: "No se pudo cerrar la asistencia. No se guardó ningún cambio." }, { status: 500 });
  }
}
